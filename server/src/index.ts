import { createApp } from "./app.ts";
import { ConfigError, loadServerConfig, type ServerConfig } from "./config.ts";
import { SessionStore } from "./store.ts";
import { NoUsageSource } from "./usage.ts";

const FLUSH_INTERVAL_MS = 50;
const TICK_INTERVAL_MS = 1000;

const log = (msg: string): void => console.log(`${new Date().toISOString()} ${msg}`);

let config: ServerConfig;
try {
  config = loadServerConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`config error: ${err.message}`);
    process.exit(1);
  }
  throw err;
}

const store = new SessionStore(config.reducer, log);
let app: ReturnType<typeof createApp>;
try {
  app = createApp({ config, store, usage: new NoUsageSource(), log });
} catch (err) {
  console.error(`cannot listen on 127.0.0.1:${config.port}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

const flush = setInterval(() => store.flush(Date.now()), FLUSH_INTERVAL_MS);
const ticker = setInterval(() => store.tick(Date.now()), TICK_INTERVAL_MS);
store.onChange((c) => {
  for (const cue of c.cues) log(`cue ${cue.kind} ${cue.sessionId.slice(0, 8)}`);
});

log(`parkiran server on http://127.0.0.1:${app.server.port} (ingest /ingest, live /ws)`);
log(`idle → doze after ${config.reducer.idleMs / 60_000} min; ws origins: ${config.allowedOrigins.join(", ")}`);

const shutdown = (): void => {
  clearInterval(flush);
  clearInterval(ticker);
  app.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
