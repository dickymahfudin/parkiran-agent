// Phase 0.5 only: minimal ingest endpoint that records arrival time vs relay spawn time, to study
// ordering and delay of async hooks. Replaced by server/ in Phase 1.
import { timingSafeEqual } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseIngestEvent } from "../shared/src/events.ts";
import { parseEnvFile } from "../shared/src/env.ts";

const REPO_ROOT = resolve(import.meta.dir, "..");
const env = parseEnvFile(readFileSync(join(REPO_ROOT, ".env"), "utf8"));
const token = Buffer.from(env.PARKIRAN_TOKEN ?? "");
if (token.length === 0) throw new Error("PARKIRAN_TOKEN missing in .env");
const port = Number(env.PARKIRAN_PORT ?? 4747);
const out = join(REPO_ROOT, "logs", "ingest-experiment.jsonl");
mkdirSync(join(REPO_ROOT, "logs"), { recursive: true, mode: 0o700 });

Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(req) {
    const arrivedAt = Date.now();
    const given = Buffer.from(req.headers.get("x-parkiran-token") ?? "");
    if (given.length !== token.length || !timingSafeEqual(given, token)) return new Response(null, { status: 401 });
    const event = parseIngestEvent(await req.json().catch(() => null));
    if (!event) return new Response(null, { status: 400 });
    appendFileSync(out, `${JSON.stringify({ arrivedAt, delayMs: arrivedAt - event.ts, ...event })}\n`, { mode: 0o600 });
    return new Response(null, { status: 204 });
  },
});
console.log(`experiment listener on 127.0.0.1:${port} -> ${out}`);
