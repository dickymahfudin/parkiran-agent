import { existsSync } from "node:fs";
import { DEFAULT_PORT, parseEnvFile } from "../../shared/src/env.ts";

/** Real binaries to try when the git on PATH is a version-manager shim (hooks run without a login shell). */
export const GIT_FALLBACKS = ["/usr/bin/git", "/opt/homebrew/bin/git"] as const;

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

/**
 * The git to pin in .env. A shim (asdf, mise, ...) needs the manager's env, which hooks do not have, so the first
 * real fallback is used instead; null when nothing usable exists (the key is then left out).
 */
export function pickGit(found: string | null, exists: (path: string) => boolean = existsSync): string | null {
  if (found !== null && !found.includes("/shims/")) return found;
  return GIT_FALLBACKS.find(exists) ?? null;
}

/** Keys the relay and server need. Existing values are never overwritten. */
export function planEnvAdditions(existingText: string | null, git: string | null = pickGit(Bun.which("git"))): EnvAddition[] {
  const existing = parseEnvFile(existingText ?? "");
  const additions: EnvAddition[] = [];
  if (!existing.PARKIRAN_TOKEN) {
    additions.push({ key: "PARKIRAN_TOKEN", value: generateToken(), display: "<random 256-bit token>" });
  }
  if (!existing.PARKIRAN_PORT) {
    additions.push({ key: "PARKIRAN_PORT", value: String(DEFAULT_PORT), display: String(DEFAULT_PORT) });
  }
  // Keep the PATH entry (e.g. /opt/homebrew/bin/git), not its realpath, so package upgrades don't break it.
  if (!existing.PARKIRAN_GIT && git !== null) additions.push({ key: "PARKIRAN_GIT", value: git, display: git });
  return additions;
}

export function applyEnvAdditions(existingText: string | null, additions: readonly EnvAddition[]): string {
  let text = existingText ?? "";
  if (text.length > 0 && !text.endsWith("\n")) text += "\n";
  for (const a of additions) text += `${a.key}=${a.value}\n`;
  return text;
}
