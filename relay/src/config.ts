import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DEFAULT_PORT, parseEnvFile } from "../../shared/src/env.ts";

export const REPO_ROOT = resolve(import.meta.dir, "..", "..");
export const ENV_PATH = join(REPO_ROOT, ".env");
export const LOG_DIR = join(REPO_ROOT, "logs");

export interface RelayConfig {
  token: string | null;
  port: number;
  gitPath: string | null;
  debug: boolean;
  raw: boolean;
}

function flag(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

/** Process env wins over the project .env so a flag can be flipped for one run. */
export function loadRelayConfig(env: Record<string, string | undefined> = process.env): RelayConfig {
  let file: Record<string, string> = {};
  try {
    file = parseEnvFile(readFileSync(ENV_PATH, "utf8"));
  } catch {
    // missing .env: relay still runs, ingest will be rejected without a token
  }
  const get = (key: string): string | undefined => env[key] ?? file[key];
  const port = Number.parseInt(get("PARKIRAN_PORT") ?? "", 10);
  return {
    token: get("PARKIRAN_TOKEN") || null,
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_PORT,
    gitPath: get("PARKIRAN_GIT") || null,
    debug: flag(get("PARKIRAN_RELAY_DEBUG")),
    raw: flag(get("PARKIRAN_RELAY_RAW")),
  };
}
