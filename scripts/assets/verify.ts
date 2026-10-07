// Pure helpers for scripts/assets/archive.ts: tar listing checks and per-file sha256 verification.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export interface TarEntry {
  name: string;
  /** '-' regular file, 'l' symlink, 'd' directory, 'h' hard link; any other tar type flag as it is. */
  type: string;
}

export function sha256Bytes(buf: Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

const TYPE_LETTER: Readonly<Record<string, string>> = { "0": "-", "\0": "-", "7": "-", "1": "h", "2": "l", "5": "d" };

/**
 * Lists a .tar.gz from its bytes, the same on every platform. `tar -t` is not used because macOS tar hides the
 * AppleDouble `._*` entries it wrote itself, while GNU tar on Linux lists (and extracts) them: an archive that looked
 * clean on macOS failed on CI. Handles ustar prefixes, pax `path` records and GNU long names.
 */
export function listTarGz(gz: Uint8Array): TarEntry[] {
  // Node buffers are typed over ArrayBufferLike; Bun.gunzipSync wants a plain ArrayBuffer view (same bytes either way).
  const buf = Bun.gunzipSync(gz as unknown as Uint8Array<ArrayBuffer>);
  const dec = new TextDecoder();
  const field = (start: number, len: number): string => {
    const end = buf.indexOf(0, start);
    return dec.decode(buf.subarray(start, end === -1 || end > start + len ? start + len : end));
  };
  const entries: TarEntry[] = [];
  let off = 0;
  let longName: string | null = null;
  let paxPath: string | null = null;
  while (off + 512 <= buf.length) {
    if (buf.subarray(off, off + 512).every((b) => b === 0)) break;
    const size = Number.parseInt(field(off + 124, 12).trim() || "0", 8);
    const flag = String.fromCharCode(buf[off + 156]!);
    const prefix = field(off + 257, 6).startsWith("ustar") ? field(off + 345, 155) : "";
    const header = prefix ? `${prefix}/${field(off, 100)}` : field(off, 100);
    const dataStart = off + 512;
    const next = dataStart + Math.ceil(size / 512) * 512;
    const data = () => dec.decode(buf.subarray(dataStart, dataStart + size));
    if (flag === "L") longName = data().replace(/\0+$/, "");
    else if (flag === "x") {
      for (const line of data().split("\n")) {
        const m = /^\d+ path=(.*)$/.exec(line);
        if (m) paxPath = m[1]!;
      }
    } else if (flag !== "g") {
      entries.push({ name: paxPath ?? longName ?? header, type: TYPE_LETTER[flag] ?? flag });
      paxPath = null;
      longName = null;
    }
    off = next;
  }
  return entries;
}

/** macOS tar stores extended attributes as `._<name>` sidecar entries (AppleDouble); they are never asset files. */
export function isAppleDouble(name: string): boolean {
  return /(^|\/)\._[^/]*$/.test(name);
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
    // Skipped on extraction too (`--exclude`), so an archive packed before COPYFILE_DISABLE still unpacks everywhere.
    if (isAppleDouble(name)) continue;
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
