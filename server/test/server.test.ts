import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IngestEvent } from "../../shared/src/events.ts";
import type { ServerMessage } from "../../shared/src/protocol.ts";
import { DEFAULT_REDUCER_CONFIG } from "../../shared/src/session.ts";
import { createApp } from "../src/app.ts";
import { ConfigError, loadServerConfig, type ServerConfig } from "../src/config.ts";
import { ReorderBuffer } from "../src/reorder.ts";
import { SessionStore } from "../src/store.ts";
import { NoUsageSource } from "../src/usage.ts";

const TOKEN = "t".repeat(64);
const ORIGIN = "http://127.0.0.1:4748";
const config: ServerConfig = {
  token: TOKEN,
  port: 0,
  allowedOrigins: [ORIGIN],
  lat: -6.2,
  lon: 106.8,
  reducer: DEFAULT_REDUCER_CONFIG,
  staticDir: null,
};
const store = new SessionStore(config.reducer);
const app = createApp({ config, store, usage: new NoUsageSource(), log: () => undefined });
const base = `http://127.0.0.1:${app.server.port}`;
afterAll(() => app.stop());
let n = 0;
const nextSession = (): string => `${String(++n).padStart(8, "0")}-1111-1111-1111-111111111111`;

const event = (over: Partial<IngestEvent> = {}): IngestEvent => ({
  v: 1,
  event: "UserPromptSubmit",
  sessionId: nextSession(),
  ts: Date.now() - 1000,
  project: "warung",
  branch: "main",
  ...over,
});

const post = (body: unknown, headers: Record<string, string> = { "x-parkiran-token": TOKEN }) =>
  fetch(`${base}/ingest`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

describe("POST /ingest", () => {
  test("accepts a valid event with the token", async () => {
    const before = store.sessions().length;
    expect((await post(event())).status).toBe(204);
    store.flush(Date.now());
    expect(store.sessions()).toHaveLength(before + 1);
  });

  test("rejects missing or wrong tokens", async () => {
    expect((await post(event(), {})).status).toBe(401);
    expect((await post(event(), { "x-parkiran-token": "x".repeat(64) })).status).toBe(401);
    expect((await post(event(), { "x-parkiran-token": TOKEN.slice(1) })).status).toBe(401);
  });

  test("rejects bad bodies", async () => {
    const before = store.sessions().length;
    expect((await post("{nope")).status).toBe(400);
    expect((await post({ ...event(), prompt: "secret" })).status).toBe(422);
    expect((await post({ ...event(), event: "Nope" })).status).toBe(422);
    expect((await post("x".repeat(5000))).status).toBe(413);
    expect((await fetch(`${base}/ingest`)).status).toBe(405);
    store.flush(Date.now());
    expect(store.sessions()).toHaveLength(before);
  });

  test("rejects foreign Host headers (DNS rebinding)", async () => {
    const res = await fetch(`${base}/ingest`, { method: "POST", headers: { host: "evil.example:80", "x-parkiran-token": TOKEN }, body: JSON.stringify(event()) });
    expect(res.status).toBe(403);
  });
});

describe("WebSocket /ws", () => {
  const open = (origin?: string) =>
    new WebSocket(`${base.replace("http", "ws")}/ws`, origin ? ({ headers: { Origin: origin } } as unknown as string[]) : undefined);

  test("refuses other origins", async () => {
    const ws = open("http://evil.example");
    const closed = await new Promise<boolean>((resolve) => {
      ws.onopen = () => resolve(false);
      ws.onerror = () => resolve(true);
      ws.onclose = () => resolve(true);
    });
    expect(closed).toBe(true);
    const res = await fetch(`${base}/ws`, { headers: { origin: "http://evil.example", upgrade: "websocket" } });
    expect(res.status).toBe(403);
  });

  test("allowed origin gets hello, then session updates and cues", async () => {
    const messages: ServerMessage[] = [];
    const ws = open(ORIGIN);
    ws.onmessage = (m) => messages.push(JSON.parse(String(m.data)));
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("ws error"));
    });
    await Bun.sleep(50);
    expect(messages[0]).toMatchObject({ type: "hello", config: { lat: -6.2, lon: 106.8 }, usage: { available: false } });

    await post(event({ event: "PreToolUse", toolName: "Bash", toolUseId: "t1" }));
    store.flush(Date.now());
    await Bun.sleep(50);
    const update = messages.find((m) => m.type === "sessions");
    expect(update).toBeDefined();
    if (update?.type === "sessions") {
      expect(update.updated[0]).toMatchObject({ phase: "working", work: "bash" });
      expect(update.updated[0]).not.toHaveProperty("openTools");
    }
    expect(messages.find((m) => m.type === "cues")).toMatchObject({ cues: [{ kind: "arrived" }] });
    ws.close();
  });
});

describe("ReorderBuffer", () => {
  const e = (ts: number, id: string): IngestEvent => event({ ts, toolUseId: id });

  test("holds recent events and releases them sorted by spawn time", () => {
    const buf = new ReorderBuffer(150);
    buf.push(e(1050, "post"), 1060);
    buf.push(e(1043, "pre"), 1065);
    expect(buf.drain(1100)).toEqual([]);
    expect(buf.drain(1200).map((x) => x.toolUseId)).toEqual(["pre", "post"]);
    expect(buf.size).toBe(0);
  });

  test("events with a future ts are released after the max hold", () => {
    const buf = new ReorderBuffer(150, 600);
    buf.push(e(99_999, "future"), 1000);
    expect(buf.drain(1500)).toEqual([]);
    expect(buf.drain(1600)).toHaveLength(1);
  });
});

describe("config", () => {
  test("requires a token and validates numbers", () => {
    expect(() => loadServerConfig({}, "/nonexistent/.env")).toThrow(ConfigError);
    expect(() => loadServerConfig({ PARKIRAN_TOKEN: TOKEN, PARKIRAN_LAT: "999" }, "/nonexistent/.env")).toThrow(ConfigError);
    const c = loadServerConfig({ PARKIRAN_TOKEN: TOKEN, PARKIRAN_IDLE_MINUTES: "0.5", PARKIRAN_PORT: "5000" }, "/nonexistent/.env");
    expect(c.reducer.idleMs).toBe(30_000);
    expect(c.allowedOrigins).toContain("http://localhost:5000");
    expect(c.allowedOrigins).toContain("http://127.0.0.1:4748");
  });
});

describe("static files (production build)", () => {
  const root = mkdtempSync(join(tmpdir(), "parkiran-static-"));
  mkdirSync(join(root, "assets", "models"), { recursive: true });
  writeFileSync(join(root, "index.html"), "<!doctype html><script type=module src=/assets/index-AbC_12-x.js></script>");
  writeFileSync(join(root, "assets", "index-AbC_12-x.js"), "export {};");
  writeFileSync(join(root, "assets", "models", "bench.glb"), "glb");
  const web = createApp({ config: { ...config, staticDir: root }, store: new SessionStore(config.reducer), usage: new NoUsageSource(), log: () => undefined });
  const at = (path: string, headers: Record<string, string> = {}) => fetch(`http://127.0.0.1:${web.server.port}${path}`, { headers });
  afterAll(() => {
    web.stop();
    rmSync(root, { recursive: true, force: true });
  });

  test("hashed build chunks are cached for good, the page and models are revalidated", async () => {
    expect((await at("/assets/index-AbC_12-x.js")).headers.get("cache-control")).toContain("immutable");
    for (const path of ["/", "/assets/models/bench.glb"]) expect((await at(path)).headers.get("cache-control")).toBe("no-cache");
  });

  test("an unchanged file answers 304 to its ETag", async () => {
    const first = await at("/assets/models/bench.glb");
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();
    const again = await at("/assets/models/bench.glb", { "if-none-match": etag! });
    expect(again.status).toBe(304);
  });

  test("a chunk from an older build is a 404, not the app page; app routes still get the page", async () => {
    const stale = await at("/assets/ez-tree.es-C7wZ5t5w.js");
    expect(stale.status).toBe(404);
    const route = await at("/some/route");
    expect(route.status).toBe(200);
    expect(await route.text()).toContain("<!doctype html>");
  });
});
