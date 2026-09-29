// Prints live state transitions from the server and, on exit, which HUD states were seen.
// Usage: bun scripts/watch.ts [--seconds=120]
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DEFAULT_PORT, DEFAULT_WEB_PORT, parseEnvFile } from "../shared/src/env.ts";
import type { PublicSession, ServerMessage } from "../shared/src/protocol.ts";
import { cueLine, stateLabel } from "../web/src/hud/labels.ts";

const REPO_ROOT = resolve(import.meta.dir, "..");
const env = parseEnvFile(readFileSync(join(REPO_ROOT, ".env"), "utf8"));
const port = Number(env.PARKIRAN_PORT ?? DEFAULT_PORT);
const webPort = Number(env.PARKIRAN_WEB_PORT ?? DEFAULT_WEB_PORT);
const seconds = Number(process.argv.find((a) => a.startsWith("--seconds="))?.split("=")[1] ?? 0);

const last = new Map<string, string>();
const seen = new Set<string>();
const cuesSeen = new Set<string>();
const name = (s: PublicSession) => `${s.project ?? "?"}@${s.branch ?? "-"} ${s.id.slice(0, 6)}`;

function record(s: PublicSession): void {
  const label = stateLabel(s, Date.now()).text;
  const friends = Object.keys(s.subagents).length;
  const key = `${label}${friends ? ` +${friends} teman` : ""}`;
  seen.add(label);
  if (friends) seen.add("ada teman");
  if (last.get(s.id) !== key) {
    console.log(`${new Date().toISOString().slice(11, 19)} ${name(s).padEnd(38)} ${key}`);
    last.set(s.id, key);
  }
}

const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Origin: `http://127.0.0.1:${webPort}` } } as unknown as string[]);
ws.onmessage = (m) => {
  const msg = JSON.parse(String(m.data)) as ServerMessage;
  if (msg.type === "hello") msg.sessions.forEach(record);
  if (msg.type === "sessions") msg.updated.forEach(record);
  if (msg.type === "cues") for (const c of msg.cues) cuesSeen.add(cueLine(c).text);
};
ws.onerror = () => {
  console.error(`cannot connect to ws://127.0.0.1:${port}/ws`);
  process.exit(1);
};

const summary = (): void => {
  console.log(`\nstates seen: ${[...seen].sort().join(", ")}`);
  console.log(`cues seen:   ${[...cuesSeen].sort().join(", ")}`);
  process.exit(0);
};
process.on("SIGINT", summary);
if (seconds > 0) setTimeout(summary, seconds * 1000);
