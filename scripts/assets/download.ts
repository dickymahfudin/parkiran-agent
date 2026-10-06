// Verified downloads for scripts/assets/fetch.ts: md5 from the Poly Haven API, checked after every write.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const FETCH_TIMEOUT_MS = 60_000;
export const DOWNLOAD_ATTEMPTS = 2;

export interface FileRef {
  url: string;
  size: number;
  md5: string;
  include?: Record<string, FileRef>;
}

export function md5File(path: string): string {
  return createHash("md5").update(readFileSync(path)).digest("hex");
}

/** True only when the file is present and its md5 is the expected one; a missing or different file is false. */
export function hasExpectedMd5(path: string, md5: string): boolean {
  return existsSync(path) && md5File(path) === md5.toLowerCase();
}

/** Narrows an API object to a FileRef, failing loudly when the hash we rely on is missing. */
export function requireFileRef(value: unknown, label: string): FileRef {
  const ref = value as Partial<FileRef> | undefined;
  if (!ref || typeof ref.url !== "string" || typeof ref.md5 !== "string" || !/^[0-9a-f]{32}$/i.test(ref.md5)) {
    throw new Error(`${label}: API response has no url/md5`);
  }
  return ref as FileRef;
}

/**
 * Downloads `ref.url` into `dest` and returns the bytes written; 0 when a matching file was already there.
 * On a hash mismatch the file is deleted and fetched once more; a second mismatch throws.
 */
export async function download(
  ref: Pick<FileRef, "url" | "md5">,
  dest: string,
  options: { fetchImpl?: typeof fetch; headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<number> {
  if (hasExpectedMd5(dest, ref.md5)) return 0;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  let lastActual = "";
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
    const res = await fetchImpl(ref.url, { headers: options.headers ?? {}, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`GET ${ref.url} → ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, buf);
    if (hasExpectedMd5(dest, ref.md5)) return buf.byteLength;
    lastActual = md5File(dest);
    rmSync(dest, { force: true });
    if (attempt < DOWNLOAD_ATTEMPTS) console.warn(`md5 mismatch for ${ref.url} (attempt ${attempt}), retrying`);
  }
  throw new Error(`${ref.url}: md5 ${lastActual} does not match ${ref.md5} after ${DOWNLOAD_ATTEMPTS} attempts`);
}
