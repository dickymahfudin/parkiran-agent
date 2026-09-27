// Measures relay wall time per hook invocation (spawn -> exit), with the ingest server down and up.
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");
const relay = process.argv[2] ? resolve(process.argv[2]) : join(REPO_ROOT, "relay", "src", "index.ts");
const runs = Number(process.env.RUNS ?? 40);

const payload = JSON.stringify({
  session_id: "00893aaf-19fa-41d2-8238-13269b9b3ca0",
  transcript_path: "/tmp/x.jsonl",
  cwd: REPO_ROOT,
  permission_mode: "default",
  hook_event_name: "PostToolUse",
  tool_name: "Read",
  tool_input: { file_path: join(REPO_ROOT, "package.json") },
  tool_response: { type: "text", file: { content: "x".repeat(20_000) } },
  tool_use_id: "toolu_bench",
});

async function once(port: number): Promise<number> {
  const t0 = performance.now();
  const proc = Bun.spawn([process.execPath, relay, "--parkiran-relay"], {
    stdin: new TextEncoder().encode(payload),
    stdout: "ignore",
    stderr: "ignore",
    env: { PATH: "/usr/bin:/bin", PARKIRAN_TOKEN: "bench", PARKIRAN_PORT: String(port), PARKIRAN_RELAY_RAW: "0", PARKIRAN_RELAY_DEBUG: "0" },
  });
  await proc.exited;
  return performance.now() - t0;
}

function stats(samples: number[]): string {
  const s = [...samples].sort((a, b) => a - b);
  const pick = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))]!.toFixed(1);
  return `p50 ${pick(0.5)} ms  p95 ${pick(0.95)} ms  max ${s[s.length - 1]!.toFixed(1)} ms  (n=${s.length})`;
}

async function bench(label: string, port: number): Promise<void> {
  await once(port);
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) samples.push(await once(port));
  console.log(`${label.padEnd(12)} ${stats(samples)}`);
}

let received = 0;
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () => {
    received++;
    return new Response(null, { status: 204 });
  },
});
const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
const deadPort = probe.port!;
probe.stop(true);

console.log(`relay: ${relay}`);
await bench("server down", deadPort);
await bench("stub up", server.port!);
// Real server: the bench token is rejected (401), which still exercises the full HTTP round trip.
if (process.env.BENCH_PORT) await bench("real server", Number(process.env.BENCH_PORT));
server.stop(true);
console.log(`events received while up: ${received}`);
