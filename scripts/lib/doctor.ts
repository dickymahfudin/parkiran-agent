import { accessSync, constants, existsSync, statSync } from "node:fs";
import { HOOK_EVENTS } from "../../shared/src/events.ts";
import { parseEnvFile } from "../../shared/src/env.ts";
import type { ManifestRead } from "./cli.ts";
import { SettingsFormatError, listOurHandlers, parseSettings, type JsonObject } from "./settings-hooks.ts";

export type Status = "ok" | "warn" | "fail";

export interface Check {
  status: Status;
  item: string;
  detail: string;
}

export const MIN_TOKEN_LENGTH = 16;
export const HEALTH_TIMEOUT_MS = 1_000;

const check = (status: Status, item: string, detail: string): Check => ({ status, item, detail });

export function formatCheck(c: Check): string {
  return `${c.status.padEnd(4)}  ${c.item.padEnd(10)}${c.detail}`;
}

/** 1 only when something failed; warnings are informational. */
export function exitCode(checks: readonly Check[]): 0 | 1 {
  return checks.some((c) => c.status === "fail") ? 1 : 0;
}

export function checkSettings(settingsPath: string, text: string | null): { check: Check; settings: JsonObject | null } {
  if (text === null) return { check: check("fail", "settings", `${settingsPath} does not exist`), settings: null };
  try {
    return { check: check("ok", "settings", `${settingsPath} parses`), settings: parseSettings(text) };
  } catch (err) {
    const why = err instanceof SettingsFormatError ? err.message : String(err);
    return { check: check("fail", "settings", `${settingsPath}: ${why}`), settings: null };
  }
}

export interface FileProbe {
  exists: (path: string) => boolean;
  executable: (path: string) => boolean;
}

export const realFiles: FileProbe = {
  exists: existsSync,
  executable: (path) => {
    try {
      accessSync(path, constants.X_OK);
      return statSync(path).isFile();
    } catch {
      return false;
    }
  },
};

/** One Parkiran handler per event, each pointing at an executable bun and an existing relay entrypoint. */
export function checkHandlers(settings: JsonObject, files: FileProbe = realFiles): Check[] {
  const handlers = listOurHandlers(settings);
  const checks: Check[] = [];
  if (handlers.length === 0) {
    return [check("fail", "hooks", "no Parkiran handlers installed (run `bun run install-hooks`)")];
  }
  const commands = new Set<string>();
  const relays = new Set<string>();
  for (const { handler } of handlers) {
    if (typeof handler.command === "string") commands.add(handler.command);
    const relay = Array.isArray(handler.args) ? handler.args[0] : undefined;
    if (typeof relay === "string") relays.add(relay);
    else checks.push(check("fail", "hooks", "a handler has no relay path in args"));
  }
  for (const command of commands) {
    checks.push(
      files.executable(command)
        ? check("ok", "bun", `${command} is executable`)
        : check("fail", "bun", `${command} is missing or not executable (run \`bun run install-hooks\` again)`),
    );
  }
  for (const relay of relays) {
    checks.push(files.exists(relay) ? check("ok", "relay", `${relay} exists`) : check("fail", "relay", `${relay} is missing`));
  }
  const counts = new Map<string, number>();
  for (const { event } of handlers) counts.set(event, (counts.get(event) ?? 0) + 1);
  const wrong = HOOK_EVENTS.filter((e) => (counts.get(e) ?? 0) !== 1).map((e) => `${e}=${counts.get(e) ?? 0}`);
  const extra = [...counts.keys()].filter((e) => !(HOOK_EVENTS as readonly string[]).includes(e));
  if (wrong.length === 0 && extra.length === 0) {
    checks.push(check("ok", "events", `one handler for each of the ${HOOK_EVENTS.length} hook events`));
  } else {
    const parts = [...wrong, ...extra.map((e) => `${e} is not a known event`)];
    checks.push(check("fail", "events", `expected exactly one handler per event: ${parts.join(", ")}`));
  }
  return checks;
}

export function checkEnv(envPath: string, text: string | null, mode: number | null): { checks: Check[]; env: Record<string, string> } {
  if (text === null) return { checks: [check("fail", ".env", `${envPath} does not exist (run \`bun run install-hooks\`)`)], env: {} };
  const env = parseEnvFile(text);
  const checks: Check[] = [];
  const token = env.PARKIRAN_TOKEN ?? "";
  checks.push(
    token.length >= MIN_TOKEN_LENGTH
      ? check("ok", ".env", `PARKIRAN_TOKEN present (${token.length} chars)`)
      : check("fail", ".env", `PARKIRAN_TOKEN missing or shorter than ${MIN_TOKEN_LENGTH} chars in ${envPath}`),
  );
  const perm = mode === null ? null : mode & 0o777;
  checks.push(
    perm === 0o600
      ? check("ok", ".env", "mode 0600")
      : check("warn", ".env", `mode ${perm === null ? "unknown" : perm.toString(8).padStart(4, "0")}, expected 0600 (chmod 600 ${envPath})`),
  );
  return { checks, env };
}

export function checkManifest(read: ManifestRead, manifestPath: string): Check {
  if (read.manifest === null) {
    return check("warn", "manifest", `${read.problem ?? `${manifestPath} unusable`}; uninstall will not remove hook containers`);
  }
  return check("ok", "manifest", `${manifestPath} matches this settings file`);
}

export function resolvePort(processEnv: Record<string, string | undefined>, fileEnv: Record<string, string>, fallback: number): number {
  const raw = processEnv.PARKIRAN_PORT ?? fileEnv.PARKIRAN_PORT;
  const port = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : fallback;
}

function isConnectionRefused(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  const message = err instanceof Error ? err.message : String(err);
  return code === "ECONNREFUSED" || code === "ConnectionRefused" || /refused|unable to connect/i.test(message);
}

export async function checkHealth(port: number, fetchImpl: typeof fetch = fetch): Promise<Check> {
  const url = `http://127.0.0.1:${port}/api/health`;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    if (!res.ok) return check("fail", "server", `GET ${url} → ${res.status}`);
    const body = (await res.json()) as { ok?: unknown; sessions?: unknown };
    if (body.ok !== true) return check("fail", "server", `GET ${url} answered without ok:true`);
    return check("ok", "server", `${url} answers (${typeof body.sessions === "number" ? body.sessions : "?"} sessions)`);
  } catch (err) {
    if (isConnectionRefused(err)) return check("warn", "server", `server not running on port ${port} (bun run server)`);
    if (err instanceof Error && err.name === "TimeoutError") {
      return check("warn", "server", `${url} did not answer within ${HEALTH_TIMEOUT_MS} ms`);
    }
    return check("fail", "server", `GET ${url} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function checkWebBuild(indexPath: string, exists: (path: string) => boolean = existsSync): Check {
  return exists(indexPath) ? check("ok", "web", `${indexPath} exists`) : check("warn", "web", `${indexPath} is missing (bun run web:build)`);
}
