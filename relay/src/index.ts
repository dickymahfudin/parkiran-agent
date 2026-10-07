// Claude Code hook entrypoint. Contract: print nothing, never throw, always exit 0, finish fast.
import { loadRelayConfig } from "./config.ts";
import { readRepoInfo } from "./git.ts";
import { appendLog, describeRawEvent } from "./rawlog.ts";
import { buildIngestEvent } from "./sanitize.ts";

// timeOrigin is the process start, i.e. the closest proxy for when the hook fired.
const spawnedAt = Math.round(performance.timeOrigin);
const MAX_STDIN_BYTES = 32 * 1024 * 1024;
const POST_TIMEOUT_MS = 300;
const HARD_EXIT_MS = 1500;

setTimeout(() => process.exit(0), HARD_EXIT_MS).unref();
process.on("uncaughtException", () => process.exit(0));
process.on("unhandledRejection", () => process.exit(0));

async function readStdin(limit: number): Promise<string | null> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of Bun.stdin.stream()) {
    total += chunk.byteLength;
    if (total > limit) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const config = loadRelayConfig();
  const debug = (msg: string): void => {
    if (config.debug) appendLog("relay-debug.log", `${new Date().toISOString()} +${Date.now() - spawnedAt}ms ${msg}`);
  };

  const text = await readStdin(MAX_STDIN_BYTES);
  if (text === null) return debug("dropped: stdin exceeds limit");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return debug("dropped: stdin is not valid JSON");
  }

  const event = buildIngestEvent(raw, spawnedAt, (cwd) => readRepoInfo(cwd, config.gitPath));
  if (config.raw) {
    appendLog("raw-events.jsonl", JSON.stringify({ at: new Date(spawnedAt).toISOString(), shape: describeRawEvent(raw), forwarded: event }));
  }
  if (event === null) return debug("dropped: unknown event or missing session_id");
  if (config.token === null) return debug("dropped: PARKIRAN_TOKEN missing in .env");

  try {
    const res = await fetch(`http://127.0.0.1:${config.port}/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-parkiran-token": config.token },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(POST_TIMEOUT_MS),
    });
    debug(`${event.event} -> ${res.status}`);
  } catch (err) {
    debug(`${event.event} dropped: ${err instanceof Error ? err.name : "post failed"}`);
  }
}

main()
  .catch(() => undefined)
  .finally(() => process.exit(0));
