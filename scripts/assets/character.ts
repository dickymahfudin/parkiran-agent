// Rebuilds the animated character from its sources (only needed to change it; `bun install` already extracts the
// built one from the asset archive). Downloads the CC0/CC-BY packs, runs the Blender scripts, compresses, repacks.
// Usage: bun scripts/assets/character.ts   (BLENDER=/path/to/blender to override the macOS default)
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..");
const RAW = join(ROOT, "assets", "raw");
const BLENDER = process.env.BLENDER ?? "/Applications/Blender.app/Contents/MacOS/Blender";

// All direct downloads, no login. Licences are listed in CREDITS.md.
const SOURCES: { url: string; to: string }[] = [
  {
    url: "https://extensions.blender.org/download/sha256:4f0a879d64a39bf646fbf5f53601ac678855da329d650617dca5737548239a87/add-on-mpfb-v2.0.17.zip",
    to: "mpfb/add-on-mpfb-v2.0.17.zip",
  },
  {
    url: "https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip",
    to: "makehuman/system_assets/makehuman_system_assets_cc0.zip",
  },
  { url: "https://files.makehumancommunity.org/asset_packs/shirts01/shirts01_cc0.zip", to: "makehuman/shirts01/shirts01_cc0.zip" },
  { url: "https://files.makehumancommunity.org/asset_packs/pants01/pants01_cc0.zip", to: "makehuman/pants01/pants01_cc0.zip" },
  { url: "https://files.makehumancommunity.org/asset_packs/pants03/pants03_ccby.zip", to: "makehuman/pants03/pants03_ccby.zip" },
  { url: "https://files.makehumancommunity.org/asset_packs/hats01/hats01_cc0.zip", to: "makehuman/hats01/hats01_cc0.zip" },
  { url: "https://opengameart.org/sites/default/files/universal_animation_librarystandard.zip", to: "quaternius-ual/ual-standard.zip" },
];

async function download(url: string, to: string): Promise<void> {
  const path = join(RAW, to);
  if (existsSync(path)) return;
  mkdirSync(dirname(path), { recursive: true });
  const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  await Bun.write(path, res);
  console.log(`downloaded ${to}`);
}

function run(cmd: string[]): void {
  console.log(`$ ${cmd.join(" ")}`);
  const r = Bun.spawnSync(cmd, { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
  if (r.exitCode !== 0) throw new Error(`${cmd[0]} exited with ${r.exitCode}`);
}

for (const s of SOURCES) await download(s.url, s.to);
if (!existsSync(BLENDER)) throw new Error(`Blender not found at ${BLENDER}; set BLENDER=/path/to/blender`);
// MPFB is a Blender extension; installing it again is a no-op.
run([BLENDER, "--command", "extension", "install-file", "-r", "user_default", "-e", join(RAW, "mpfb", "add-on-mpfb-v2.0.17.zip")]);
run([BLENDER, "--background", "--python", "scripts/blender/make_character.py", "--", ROOT]);
run([BLENDER, "--background", "assets/generated/character/character.blend", "--python", "scripts/blender/make_animations.py", "--", ROOT]);
run(["bun", "scripts/assets/build.ts", "--only=character"]);
run(["bun", "scripts/assets/archive.ts", "pack"]);
