// Downloads the catalogued CC0 assets from the public Poly Haven API into assets/raw/ (gitignored).
// Usage: bun scripts/assets/fetch.ts
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { POLYHAVEN_HDRIS, POLYHAVEN_MODELS, POLYHAVEN_TEXTURES } from "./catalog.ts";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const RAW = join(REPO_ROOT, "assets", "raw", "polyhaven");
const API = "https://api.polyhaven.com";
const UA = { "user-agent": "parkiran-agent/0.1 (personal, non-commercial)" };

interface FileRef {
  url: string;
  size: number;
  include?: Record<string, FileRef>;
}

export interface ManifestEntry {
  id: string;
  kind: "model" | "texture" | "hdri";
  name: string;
  authors: string[];
  page: string;
  license: "CC0";
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return (await res.json()) as T;
}

async function download(url: string, dest: string): Promise<number> {
  if (existsSync(dest)) return 0;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, buf);
  return buf.byteLength;
}

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
  total += await download(gltf.url, join(dir, `${id}.gltf`));
  for (const [rel, ref] of Object.entries(gltf.include ?? {})) total += await download(ref.url, join(dir, rel));
  manifest.push(await info(id, "model"));
  console.log(`model   ${id}`);
}

for (const { id } of POLYHAVEN_TEXTURES) {
  const files = await getJson<Record<string, Record<string, Record<string, FileRef>>>>(`${API}/files/${id}`);
  const dir = join(RAW, "textures", id);
  for (const [map, out] of [["Diffuse", "diff"], ["nor_gl", "nor"], ["arm", "arm"]] as const) {
    const ref = files[map]?.["2k"]?.jpg ?? files[map]?.["1k"]?.jpg;
    if (!ref) throw new Error(`${id}: missing ${map}`);
    total += await download(ref.url, join(dir, `${out}.jpg`));
  }
  manifest.push(await info(id, "texture"));
  console.log(`texture ${id}`);
}

for (const { id } of POLYHAVEN_HDRIS) {
  const files = await getJson<{ hdri: Record<string, { hdr: FileRef }> }>(`${API}/files/${id}`);
  const ref = files.hdri["1k"]?.hdr;
  if (!ref) throw new Error(`${id}: no 1k hdr`);
  total += await download(ref.url, join(RAW, "hdris", `${id}_1k.hdr`));
  manifest.push(await info(id, "hdri"));
  console.log(`hdri    ${id}`);
}

writeFileSync(join(RAW, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`done, downloaded ${(total / 1048576).toFixed(1)} MB (existing files skipped)`);
