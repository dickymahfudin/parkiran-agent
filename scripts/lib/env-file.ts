import { DEFAULT_PORT, parseEnvFile } from "../../shared/src/env.ts";

export interface EnvAddition {
  key: string;
  value: string;
  /** Printed instead of the value. */
  display: string;
}

export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Buffer.from(bytes).toString("hex");
}

/** Keys the relay and server need. Existing values are never overwritten. */
export function planEnvAdditions(existingText: string | null): EnvAddition[] {
  const existing = parseEnvFile(existingText ?? "");
  const additions: EnvAddition[] = [];
  if (!existing.PARKIRAN_TOKEN) {
    additions.push({ key: "PARKIRAN_TOKEN", value: generateToken(), display: "<random 256-bit token>" });
  }
  if (!existing.PARKIRAN_PORT) {
    additions.push({ key: "PARKIRAN_PORT", value: String(DEFAULT_PORT), display: String(DEFAULT_PORT) });
  }
  if (!existing.PARKIRAN_GIT) {
    // Keep the PATH entry (e.g. /opt/homebrew/bin/git), not its realpath, so package upgrades don't break it.
    const git = Bun.which("git");
    if (git) additions.push({ key: "PARKIRAN_GIT", value: git, display: git });
  }
  return additions;
}

export function applyEnvAdditions(existingText: string | null, additions: readonly EnvAddition[]): string {
  let text = existingText ?? "";
  if (text.length > 0 && !text.endsWith("\n")) text += "\n";
  for (const a of additions) text += `${a.key}=${a.value}\n`;
  return text;
}
