import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { PAYLOADS, SECRET } from "./fixtures.ts";

const RELAY = join(import.meta.dir, "..", "src", "index.ts");
const TOKEN = "test-token-0123456789";

const received: { token: string | null; body: string }[] = [];
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    received.push({ token: req.headers.get("x-parkiran-token"), body: await req.text() });
    return new Response(null, { status: 204 });
  },
});
afterAll(() => server.stop(true));

async function runRelay(stdin: string, port: number) {
  const started = performance.now();
  const proc = Bun.spawn([process.execPath, RELAY, "--parkiran-relay"], {
    stdin: new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PATH: "/usr/bin:/bin",
      PARKIRAN_TOKEN: TOKEN,
      PARKIRAN_PORT: String(port),
      PARKIRAN_RELAY_DEBUG: "0",
      PARKIRAN_RELAY_RAW: "0",
    },
  });
  const [exitCode, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { exitCode, stdout, stderr, ms: performance.now() - started };
}

describe("relay process", () => {
  test("posts the sanitised event with the token, prints nothing, exits 0", async () => {
    received.length = 0;
    const res = await runRelay(JSON.stringify(PAYLOADS.PreToolUse), server.port!);
    expect(res).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
    expect(received).toHaveLength(1);
    expect(received[0]!.token).toBe(TOKEN);
    expect(received[0]!.body).not.toContain(SECRET);
    expect(JSON.parse(received[0]!.body)).toMatchObject({ event: "PreToolUse", toolName: "Bash", v: 1 });
  });

  test("server down: drops the event quickly and still exits 0", async () => {
    const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
    const deadPort = probe.port!;
    probe.stop(true);
    const res = await runRelay(JSON.stringify(PAYLOADS.Stop), deadPort);
    expect(res).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
    expect(res.ms).toBeLessThan(1000);
  });

  test("garbage input exits 0 without posting", async () => {
    received.length = 0;
    for (const input of ["", "not json", "[1,2]", JSON.stringify({ hook_event_name: "Stop" })]) {
      const res = await runRelay(input, server.port!);
      expect(res).toMatchObject({ exitCode: 0, stdout: "" });
    }
    expect(received).toHaveLength(0);
  });
});
