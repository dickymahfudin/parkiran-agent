// The optimised web assets live in the repo as one archive (assets/parkiran-assets.tar.gz) and are extracted into
// web/public on `bun install` (postinstall). Usage: bun scripts/assets/archive.ts pack|unpack
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..");
const PUBLIC = join(ROOT, "web", "public");
const ASSETS = join(PUBLIC, "assets");
const ARCHIVE = join(ROOT, "assets", "parkiran-assets.tar.gz");
const MANIFEST = join(ROOT, "assets", "parkiran-assets.json");
const STAMP = join(ASSETS, ".archive-sha256");

interface Manifest {
  archiveSha256: string;
  archiveBytes: number;
  files: Record<string, string>;
}

const sha256 = (buf: Uint8Array) => createHash("sha256").update(buf).digest("hex");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name.startsWith(".")) return [];
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function run(cmd: string[]): string {
  const r = Bun.spawnSync(cmd, { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`${cmd.join(" ")} failed: ${r.stderr.toString().trim()}`);
  return r.stdout.toString();
}

function pack(): void {
  if (!existsSync(ASSETS)) throw new Error("web/public/assets is missing; run `bun run assets` first");
  const files = Object.fromEntries(walk(ASSETS).sort().map((p) => [relative(PUBLIC, p), sha256(readFileSync(p))]));
  const previous = existsSync(MANIFEST) ? (JSON.parse(readFileSync(MANIFEST, "utf8")) as Manifest) : null;
  if (previous && existsSync(ARCHIVE) && JSON.stringify(previous.files) === JSON.stringify(files)) {
    console.log("assets unchanged, archive kept");
    return;
  }
  // gzip headers carry a timestamp, so the archive is only rewritten when the content changed (above).
  run(["tar", "-czf", ARCHIVE, "-C", PUBLIC, ...Object.keys(files)]);
  const archive = readFileSync(ARCHIVE);
  const manifest: Manifest = { archiveSha256: sha256(archive), archiveBytes: archive.byteLength, files };
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(STAMP, manifest.archiveSha256);
  console.log(`packed ${Object.keys(files).length} files, ${(archive.byteLength / 1048576).toFixed(1)} MB → assets/parkiran-assets.tar.gz`);
}

function copyBasis(): void {
  const src = join(ROOT, "web", "node_modules", "three", "examples", "jsm", "libs", "basis");
  if (!existsSync(src)) throw new Error("three is not installed in web/; run `bun install`");
  const out = join(PUBLIC, "basis");
  mkdirSync(out, { recursive: true });
  for (const f of ["basis_transcoder.js", "basis_transcoder.wasm"]) copyFileSync(join(src, f), join(out, f));
}

function unpack(): void {
  if (!existsSync(ARCHIVE) || !existsSync(MANIFEST)) {
    console.warn("⚠ assets/parkiran-assets.tar.gz not found: the scene will report missing assets. Rebuild with `bun run assets`.");
    return;
  }
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as Manifest;
  const archive = readFileSync(ARCHIVE);
  const digest = sha256(archive);
  if (digest !== manifest.archiveSha256) throw new Error("asset archive checksum does not match assets/parkiran-assets.json");
  copyBasis();
  if (existsSync(STAMP) && readFileSync(STAMP, "utf8").trim() === digest) return;
  // Only our own relative paths under assets/ may be written.
  const entries = run(["tar", "-tzf", ARCHIVE]).split("\n").filter(Boolean);
  const bad = entries.filter((e) => !e.startsWith("assets/") || e.split("/").includes("..") || e.startsWith("/"));
  if (bad.length > 0) throw new Error(`refusing to extract unexpected paths: ${bad.slice(0, 3).join(", ")}`);
  mkdirSync(PUBLIC, { recursive: true });
  run(["tar", "-xzf", ARCHIVE, "-C", PUBLIC]);
  writeFileSync(STAMP, digest);
  console.log(`extracted ${entries.length} asset files into web/public/assets`);
}

const cmd = process.argv[2];
if (cmd === "pack") pack();
else if (cmd === "unpack") unpack();
else throw new Error("usage: bun scripts/assets/archive.ts pack|unpack");
