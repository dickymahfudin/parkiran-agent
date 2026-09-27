import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { InstallManifest } from "./settings-hooks.ts";

export const REPO_ROOT = resolve(import.meta.dir, "..", "..");
export const RELAY_PATH = join(REPO_ROOT, "relay", "src", "index.ts");
export const STATUSLINE_PATH = join(REPO_ROOT, "relay", "src", "statusline.ts");
// Overridable so tests never touch the real project state.
export const ENV_PATH = process.env.PARKIRAN_ENV_FILE ?? join(REPO_ROOT, ".env");
export const MANIFEST_PATH = process.env.PARKIRAN_MANIFEST_FILE ?? join(REPO_ROOT, ".parkiran", "hooks-install.json");

const tty = process.stdout.isTTY === true;
export const color = {
  red: (s: string) => (tty ? `\x1b[31m${s}\x1b[0m` : s),
  green: (s: string) => (tty ? `\x1b[32m${s}\x1b[0m` : s),
  cyan: (s: string) => (tty ? `\x1b[36m${s}\x1b[0m` : s),
  dim: (s: string) => (tty ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s: string) => (tty ? `\x1b[1m${s}\x1b[0m` : s),
};

export function colorDiff(diff: string): string {
  return diff
    .split("\n")
    .map((line) => {
      if (line.startsWith("+++") || line.startsWith("---")) return color.bold(line);
      if (line.startsWith("@@")) return color.cyan(line);
      if (line.startsWith("+")) return color.green(line);
      if (line.startsWith("-")) return color.red(line);
      return line;
    })
    .join("\n");
}

export function fail(message: string): never {
  console.error(color.red(`✗ ${message}`));
  process.exit(1);
}

export function settingsPathFromArgs(argv: readonly string[]): string {
  const flag = argv.find((a) => a.startsWith("--settings="));
  return resolve(flag ? flag.slice("--settings=".length) : join(homedir(), ".claude", "settings.json"));
}

/** Follows a symlinked settings file so we replace the target, not the link. */
export function resolveWritePath(path: string): string {
  return existsSync(path) && lstatSync(path).isSymbolicLink() ? realpathSync(path) : path;
}

export function readTextIfExists(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

export function atomicWrite(path: string, text: string): void {
  const mode = existsSync(path) ? statSync(path).mode & 0o777 : 0o600;
  const tmp = join(dirname(path), `.${Date.now()}-${process.pid}.parkiran.tmp`);
  writeFileSync(tmp, text, { mode });
  try {
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

export interface StoredManifest extends InstallManifest {
  createdFile: boolean;
}

export function readManifest(settingsPath: string): StoredManifest | null {
  const text = readTextIfExists(MANIFEST_PATH);
  if (text === null) return null;
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null) fail(`${MANIFEST_PATH} is malformed`);
  const m = parsed as Partial<StoredManifest>;
  if (typeof m.settingsPath !== "string" || !Array.isArray(m.createdPaths)) fail(`${MANIFEST_PATH} is malformed`);
  if (m.settingsPath !== settingsPath) return null;
  return { settingsPath: m.settingsPath, createdPaths: m.createdPaths.map(String), createdFile: m.createdFile === true };
}

export function writeManifest(manifest: StoredManifest): void {
  mkdirSync(dirname(MANIFEST_PATH), { recursive: true, mode: 0o700 });
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
}

export function removeManifest(): void {
  rmSync(MANIFEST_PATH, { force: true });
}

export function confirm(question: string): boolean {
  const answer = prompt(`${question} [y/N]`);
  return answer !== null && /^y(es)?$/i.test(answer.trim());
}
