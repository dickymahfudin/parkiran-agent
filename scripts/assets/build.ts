// Optimises raw assets for the web: models → GLB (dedup, prune, resized KTX2 textures, meshopt),
// texture sets → KTX2, HDRIs copied, the animated character (from scripts/blender) compressed.
// Usage: bun scripts/assets/build.ts [--only=<id>|--only=character]
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { NodeIO, getBounds, type Document } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, resample, simplify, simplifyPrimitive, textureCompress, weld } from "@gltf-transform/functions";
import { encodeToKTX2 } from "ktx2-encoder";
import { ktx2 } from "ktx2-encoder/gltf-transform";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import { POLYHAVEN_HDRIS, POLYHAVEN_MODELS, POLYHAVEN_TEXTURES } from "./catalog.ts";
import type { ManifestEntry } from "./fetch.ts";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const RAW = join(REPO_ROOT, "assets", "raw", "polyhaven");
const OUT = join(REPO_ROOT, "web", "public", "assets");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);

const decode = async (buf: Uint8Array) => {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data) };
};

const COLOR = {
  enableDebug: false,
  isUASTC: false,
  qualityLevel: 160,
  compressionLevel: 2,
  isPerceptual: true,
  generateMipmap: true,
  imageDecoder: decode,
} as const;
const DATA = { ...COLOR, isPerceptual: false } as const;
const NORMAL = {
  enableDebug: false,
  isUASTC: true,
  uastcLDRQualityLevel: 1,
  needSupercompression: true,
  isNormalMap: true,
  isPerceptual: false,
  generateMipmap: true,
  imageDecoder: decode,
} as const;

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "meshopt.encoder": MeshoptEncoder,
  "meshopt.decoder": MeshoptDecoder,
});

const report: Record<string, { size: number[]; bytes: number }> = {};

/**
 * Scan-dense props (a 17k-triangle cardboard box, a 30k lamp post) are simplified until the surface would move by
 * 0.4 % of the mesh radius (≈2 mm on a gallon): the normal maps carry the detail, and every triangle is drawn twice
 * a frame (shadow map + main pass).
 */
const SIMPLIFY_ERROR = 0.004;

/**
 * The MPFB body (21k triangles, drawn for every person and rider in both passes) is dense where it is nearly flat; half
 * of it goes, the surface moving at most 0.05 % of the body's radius (under half a millimetre), so the face, hands and
 * the rings round knees and elbows stay.
 */
const BODY_SIMPLIFY = { ratio: 0.5, error: 0.0005 } as const;

async function buildModel(id: string, textureSize: number): Promise<void> {
  const src = join(RAW, "models", id, `${id}.gltf`);
  const doc: Document = await io.read(src);
  await doc.transform(
    dedup(),
    prune(),
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: 0, error: SIMPLIFY_ERROR }),
    textureCompress({ encoder: sharp, resize: [textureSize, textureSize], targetFormat: "png" }),
    ktx2({ ...NORMAL, slots: /normalTexture/ }),
    ktx2({ ...COLOR, slots: /baseColorTexture|emissiveTexture/ }),
    ktx2({ ...DATA, slots: /metallicRoughnessTexture|occlusionTexture/ }),
    meshopt({ encoder: MeshoptEncoder, level: "medium" }),
  );
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]!;
  const b = getBounds(scene);
  const size = b.max.map((v, i) => Math.round((v - b.min[i]!) * 100) / 100);
  const bytes = await io.writeBinary(doc);
  mkdirSync(join(OUT, "models"), { recursive: true });
  writeFileSync(join(OUT, "models", `${id}.glb`), bytes);
  report[id] = { size, bytes: bytes.byteLength };
  console.log(`model   ${id.padEnd(28)} ${size.join(" × ")} m  ${(bytes.byteLength / 1024).toFixed(0)} KB`);
}

async function buildTexture(id: string, size: number): Promise<void> {
  const dir = join(OUT, "textures", id);
  mkdirSync(dir, { recursive: true });
  let bytes = 0;
  for (const [name, opts] of [
    ["diff", COLOR],
    ["nor", NORMAL],
    ["arm", DATA],
  ] as const) {
    const resized = await sharp(readFileSync(join(RAW, "textures", id, `${name}.jpg`)))
      .resize(size, size)
      .png()
      .toBuffer();
    const out = await encodeToKTX2(new Uint8Array(resized), opts);
    writeFileSync(join(dir, `${name}.ktx2`), out);
    bytes += out.byteLength;
  }
  console.log(`texture ${id.padEnd(28)} ${size}px  ${(bytes / 1024).toFixed(0)} KB`);
}

for (const { id, textureSize } of POLYHAVEN_MODELS) if (!only || only === id) await buildModel(id, textureSize);
for (const { id, size } of POLYHAVEN_TEXTURES) if (!only || only === id) await buildTexture(id, size);
async function buildCharacter(): Promise<void> {
  const dir = join(REPO_ROOT, "assets", "generated", "character");
  const src = join(dir, "character.glb");
  if (!existsSync(src)) throw new Error("run scripts/blender/make_character.py and make_animations.py first");
  const doc = await io.read(src);
  const skin = /young|skin/i;
  await doc.transform(
    dedup(),
    prune(),
    resample(),
    weld(),
    (d) => {
      for (const mesh of d.getRoot().listMeshes()) {
        if (!mesh.getName().startsWith("Body_")) continue;
        for (const prim of mesh.listPrimitives()) simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ...BODY_SIMPLIFY });
      }
    },
    // Faces are a few hundred pixels tall at most: 1K skin, 512 for clothes, hair and eyes.
    textureCompress({ encoder: sharp, pattern: skin, resize: [1024, 1024], targetFormat: "png" }),
    textureCompress({ encoder: sharp, pattern: /^(?!.*(young|skin))/i, resize: [512, 512], targetFormat: "png" }),
    ktx2({ ...NORMAL, slots: /normalTexture/ }),
    ktx2({ ...COLOR, slots: /baseColorTexture/ }),
    meshopt({ encoder: MeshoptEncoder, level: "medium" }),
  );
  const bytes = await io.writeBinary(doc);
  mkdirSync(join(OUT, "character"), { recursive: true });
  writeFileSync(join(OUT, "character", "character.glb"), bytes);
  copyFileSync(join(dir, "clips.json"), join(OUT, "character", "clips.json"));
  console.log(`character ${(bytes.byteLength / 1048576).toFixed(1)} MB, ${doc.getRoot().listAnimations().length} clips`);
}

if (!only || only === "character") await buildCharacter();

mkdirSync(join(OUT, "hdri"), { recursive: true });
for (const { id } of POLYHAVEN_HDRIS) {
  if (only && only !== id) continue;
  copyFileSync(join(RAW, "hdris", `${id}_1k.hdr`), join(OUT, "hdri", `${id}_1k.hdr`));
}

// Basis transcoder for KTX2 in the browser.
const basisSrc = join(REPO_ROOT, "web", "node_modules", "three", "examples", "jsm", "libs", "basis");
mkdirSync(join(REPO_ROOT, "web", "public", "basis"), { recursive: true });
for (const f of ["basis_transcoder.js", "basis_transcoder.wasm"]) copyFileSync(join(basisSrc, f), join(REPO_ROOT, "web", "public", "basis", f));

if (!only) {
  writeFileSync(join(OUT, "models", "sizes.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeCredits();
}

function writeCredits(): void {
  const manifestPath = join(RAW, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error("run scripts/assets/fetch.ts first");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ManifestEntry[];
  const rows = manifest.map((m) => `| ${m.name} (\`${m.id}\`, ${m.kind}) | ${m.authors.join(", ")} | ${m.page} | CC0 |`).join("\n");
  const credits = join(REPO_ROOT, "CREDITS.md");
  const text = readFileSync(credits, "utf8");
  const start = "<!-- polyhaven:start -->";
  const end = "<!-- polyhaven:end -->";
  const block = `${start}\n| Asset | Author | Source | Licence |\n|---|---|---|---|\n${rows}\n${end}`;
  const next = text.includes(start) ? text.replace(new RegExp(`${start}[\\s\\S]*${end}`), block) : `${text.trimEnd()}\n\n### Poly Haven\n\n${block}\n`;
  writeFileSync(credits, next);
}
