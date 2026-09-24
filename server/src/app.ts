import { timingSafeEqual } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { join, normalize, sep } from "node:path";
import type { ServerWebSocket } from "bun";
import { parseIngestEvent } from "../../shared/src/events.ts";
import type { ServerMessage } from "../../shared/src/protocol.ts";
import type { ServerConfig } from "./config.ts";
import type { SessionStore } from "./store.ts";
import type { UsageSource } from "./usage.ts";

const MAX_BODY_BYTES = 4096;
const TOPIC = "world";

export interface AppDeps {
  config: ServerConfig;
  store: SessionStore;
  usage: UsageSource;
  log: (msg: string) => void;
}

function tokenMatches(given: string | null, expected: string): boolean {
  if (given === null) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const text = (status: number, body: string): Response =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

export function createApp({ config, store, usage, log }: AppDeps) {
  const send = (ws: ServerWebSocket<unknown>, msg: ServerMessage): void => {
    ws.send(JSON.stringify(msg));
  };

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: config.port,
    async fetch(req, srv) {
      const url = new URL(req.url);
      // DNS rebinding guard: only our own host names.
      const host = req.headers.get("host");
      if (host !== `127.0.0.1:${srv.port}` && host !== `localhost:${srv.port}`) return text(403, "forbidden host");

      try {
        if (url.pathname === "/ingest") {
          if (req.method !== "POST") return text(405, "method not allowed");
          if (!tokenMatches(req.headers.get("x-parkiran-token"), config.token)) return text(401, "unauthorized");
          const declared = Number(req.headers.get("content-length") ?? "0");
          if (declared > MAX_BODY_BYTES) return text(413, "payload too large");
          const raw = await req.text();
          if (raw.length > MAX_BODY_BYTES) return text(413, "payload too large");
          let body: unknown;
          try {
            body = JSON.parse(raw);
          } catch {
            return text(400, "invalid json");
          }
          const event = parseIngestEvent(body);
          if (!event) return text(422, "invalid event");
          store.ingest(event, Date.now());
          return new Response(null, { status: 204 });
        }

        if (url.pathname === "/ws") {
          const origin = req.headers.get("origin");
          if (origin === null || !config.allowedOrigins.includes(origin)) return text(403, "forbidden origin");
          return srv.upgrade(req) ? undefined : text(400, "websocket upgrade failed");
        }

        if (url.pathname === "/api/health") {
          return Response.json({ ok: true, sessions: store.sessions().length });
        }

        if (req.method === "GET" && config.staticDir && existsSync(config.staticDir)) {
          return serveStatic(config.staticDir, url.pathname);
        }
        return text(404, "not found");
      } catch (err) {
        log(`error handling ${req.method} ${url.pathname}: ${err instanceof Error ? err.message : String(err)}`);
        return text(500, "internal error");
      }
    },
    websocket: {
      open(ws) {
        ws.subscribe(TOPIC);
        send(ws, {
          type: "hello",
          serverTime: Date.now(),
          config: { lat: config.lat, lon: config.lon, idleMinutes: config.reducer.idleMs / 60_000 },
          sessions: store.sessions(),
          usage: usage.snapshot(),
        });
      },
      message() {
        // Read-only feed; clients never send commands.
      },
    },
  });

  const unsubscribe = store.onChange((change) => {
    const serverTime = Date.now();
    if (change.updated.length > 0 || change.removed.length > 0) {
      server.publish(TOPIC, JSON.stringify({ type: "sessions", serverTime, updated: change.updated, removed: change.removed } satisfies ServerMessage));
    }
    if (change.cues.length > 0) {
      server.publish(TOPIC, JSON.stringify({ type: "cues", serverTime, cues: change.cues } satisfies ServerMessage));
    }
  });

  return {
    server,
    stop(): void {
      unsubscribe();
      server.stop(true);
    },
  };
}

function serveStatic(root: string, pathname: string): Response {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, "");
  const full = join(root, rel);
  if (!full.startsWith(root + sep) && full !== root) return text(403, "forbidden");
  const file = existsSync(full) && statSync(full).isFile() ? full : join(root, "index.html");
  return existsSync(file) ? new Response(Bun.file(file)) : text(404, "not found");
}
