import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DEFAULT_PORT, DEFAULT_WEB_PORT, parseEnvFile } from "../../shared/src/env.ts";
import { DEFAULT_REDUCER_CONFIG, type ReducerConfig } from "../../shared/src/session.ts";

export const REPO_ROOT = resolve(import.meta.dir, "..", "..");

export interface ServerConfig {
  token: string;
  port: number;
  /** Browser origins allowed to open the WebSocket (WebSockets are not covered by CORS). */
  allowedOrigins: string[];
  lat: number;
  lon: number;
  reducer: ReducerConfig;
  /** Directory with the built web app to serve, if any. */
  staticDir: string | null;
}

export class ConfigError extends Error {}

function num(raw: string | undefined, fallback: number, min: number, max: number, name: string): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) throw new ConfigError(`${name} must be a number in [${min}, ${max}], got "${raw}"`);
  return n;
}

export function loadServerConfig(env: Record<string, string | undefined> = process.env, envFile = join(REPO_ROOT, ".env")): ServerConfig {
  let file: Record<string, string> = {};
  try {
    file = parseEnvFile(readFileSync(envFile, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const get = (key: string): string | undefined => env[key] ?? file[key];

  const token = get("PARKIRAN_TOKEN");
  if (!token || token.length < 16) throw new ConfigError("PARKIRAN_TOKEN missing or too short in .env (run `bun run install-hooks`)");
  const port = num(get("PARKIRAN_PORT"), DEFAULT_PORT, 1, 65535, "PARKIRAN_PORT");
  const webPort = num(get("PARKIRAN_WEB_PORT"), DEFAULT_WEB_PORT, 1, 65535, "PARKIRAN_WEB_PORT");
  const extra = (get("PARKIRAN_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  return {
    token,
    port,
    allowedOrigins: [...[port, webPort].flatMap((p) => [`http://127.0.0.1:${p}`, `http://localhost:${p}`]), ...extra],
    lat: num(get("PARKIRAN_LAT"), -6.2, -90, 90, "PARKIRAN_LAT"),
    lon: num(get("PARKIRAN_LON"), 106.8, -180, 180, "PARKIRAN_LON"),
    reducer: {
      ...DEFAULT_REDUCER_CONFIG,
      idleMs: num(get("PARKIRAN_IDLE_MINUTES"), 30, 0.05, 24 * 60, "PARKIRAN_IDLE_MINUTES") * 60_000,
      reapMs: num(get("PARKIRAN_REAP_HOURS"), 12, 0.01, 24 * 30, "PARKIRAN_REAP_HOURS") * 3_600_000,
    },
    // Relative to the repo, absolute as given; trailing slashes dropped.
    staticDir: resolve(REPO_ROOT, get("PARKIRAN_STATIC_DIR") ?? join("web", "dist")),
  };
}
