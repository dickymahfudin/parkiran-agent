// Pure helpers for scripts/assets/archive.ts: tar listing checks and per-file sha256 verification.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export interface TarEntry {
  name: string;
  /** First character of the `tar -tvzf` line: '-' regular file, 'l' symlink, 'd' directory, 'h' hard link, ... */
  type: string;
}

export function sha256Bytes(buf: Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Pairs the plain listing (`tar -tzf`, one name per line) with the verbose one (`tar -tvzf`) so the type flag
 * is read from the verbose line and the name from the plain one, independent of bsdtar/GNU column layouts.
 */
export function parseTarListing(plain: string, verbose: string): TarEntry[] {
  const names = plain.split("\n").filter((l) => l.length > 0);
  const lines = verbose.split("\n").filter((l) => l.length > 0);
  if (names.length !== lines.length) {
    throw new Error(`tar listings disagree (${names.length} names vs ${lines.length} verbose lines); refusing to extract`);
  }
  return names.map((name, i) => ({ name, type: lines[i]!.charAt(0) }));
}

/** A relative path under `assets/` with no `..`, no absolute prefix and no control characters. */
export function isSafeAssetPath(name: string): boolean {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters in a tar entry name are rejected on purpose
  if (isAbsolute(name) || name.startsWith("\\") || /[\u0000-\u001f]/.test(name)) return false;
  const parts = name.split(/[\\/]/);
  return parts[0] === "assets" && parts.length > 1 && parts.every((p) => p !== "" && p !== "." && p !== "..");
}

/** Reasons to refuse the archive: anything that is not a regular file at a safe path listed in the manifest. */
export function badEntries(entries: readonly TarEntry[], expected: ReadonlySet<string>): string[] {
  const reasons: string[] = [];
  for (const { name, type } of entries) {
    if (type !== "-") reasons.push(`${name}: not a regular file (type '${type}')`);
    else if (!isSafeAssetPath(name)) reasons.push(`${name}: path escapes web/public/assets`);
    else if (!expected.has(name)) reasons.push(`${name}: not listed in the manifest`);
  }
  return reasons;
}

/** Every manifest file must exist under `root` with the recorded sha256. Returns the problems, empty when all good. */
export function verifyFiles(root: string, files: Readonly<Record<string, string>>): string[] {
  const problems: string[] = [];
  for (const [rel, expected] of Object.entries(files)) {
    const path = join(root, rel);
    if (!existsSync(path)) {
      problems.push(`${rel}: missing`);
      continue;
    }
    const actual = sha256Bytes(readFileSync(path));
    if (actual !== expected) problems.push(`${rel}: sha256 ${actual.slice(0, 12)}… expected ${expected.slice(0, 12)}…`);
  }
  return problems;
}
