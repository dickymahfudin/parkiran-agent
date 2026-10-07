// Downloads the catalogued CC0 assets from the public Poly Haven API into assets/raw/ (gitignored).
// Usage: bun scripts/assets/fetch.ts
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { POLYHAVEN_HDRIS, POLYHAVEN_MODELS, POLYHAVEN_TEXTURES } from "./catalog.ts";
import { FETCH_TIMEOUT_MS, download as verifiedDownload, requireFileRef, type FileRef } from "./download.ts";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const RAW = join(REPO_ROOT, "assets", "raw", "polyhaven");
const API = "https://api.polyhaven.com";
const UA = { "user-agent": "parkiran-agent/0.1 (personal, non-commercial)" };

export interface ManifestEntry {
  id: string;
  kind: "model" | "texture" | "hdri";
  name: string;
  authors: string[];
  page: string;
  license: "CC0";
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return (await res.json()) as T;
}

/** Skips files already present with the right md5; re-downloads once on a mismatch, then fails. */
const download = (ref: unknown, label: string, dest: string): Promise<number> => verifiedDownload(requireFileRef(ref, label), dest, { headers: UA });

async function info(id: string, kind: ManifestEntry["kind"]): Promise<ManifestEntry> {
  const meta = await getJson<{ name: string; authors: Record<string, string> }>(`${API}/info/${id}`);
  return { id, kind, name: meta.name, authors: Object.keys(meta.authors), page: `https://polyhaven.com/a/${id}`, license: "CC0" };
}

let total = 0;
const manifest: ManifestEntry[] = [];

for (const { id } of POLYHAVEN_MODELS) {
  const files = await getJson<{ gltf: Record<string, { gltf: FileRef }> }>(`${API}/files/${id}`);
  const gltf = files.gltf["1k"]?.gltf;
  if (!gltf) throw new Error(`${id}: no 1k glTF`);
  const dir = join(RAW, "models", id);
  total += await download(gltf, `${id} gltf`, join(dir, `${id}.gltf`));
  for (const [rel, ref] of Object.entries(gltf.include ?? {})) total += await download(ref, `${id} ${rel}`, join(dir, rel));
  manifest.push(await info(id, "model"));
  console.log(`model   ${id}`);
}

for (const { id } of POLYHAVEN_TEXTURES) {
  const files = await getJson<Record<string, Record<string, Record<string, FileRef>>>>(`${API}/files/${id}`);
  const dir = join(RAW, "textures", id);
  for (const [map, out] of [
    ["Diffuse", "diff"],
    ["nor_gl", "nor"],
    ["arm", "arm"],
  ] as const) {
    const ref = files[map]?.["2k"]?.jpg ?? files[map]?.["1k"]?.jpg;
    if (!ref) throw new Error(`${id}: missing ${map}`);
    total += await download(ref, `${id} ${map}`, join(dir, `${out}.jpg`));
  }
  manifest.push(await info(id, "texture"));
  console.log(`texture ${id}`);
}

for (const { id } of POLYHAVEN_HDRIS) {
  const files = await getJson<{ hdri: Record<string, { hdr: FileRef }> }>(`${API}/files/${id}`);
  const ref = files.hdri["1k"]?.hdr;
  if (!ref) throw new Error(`${id}: no 1k hdr`);
  total += await download(ref, `${id} hdr`, join(RAW, "hdris", `${id}_1k.hdr`));
  manifest.push(await info(id, "hdri"));
  console.log(`hdri    ${id}`);
}

writeFileSync(join(RAW, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`done, downloaded ${(total / 1048576).toFixed(1)} MB (files already present with a matching md5 skipped)`);
