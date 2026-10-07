import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isAppleDouble, listTarGz } from "../assets/verify.ts";

const ROOT = join(import.meta.dir, "..", "..");
const ARCHIVE = join(ROOT, "assets", "parkiran-assets.tar.gz");
const MANIFEST = join(ROOT, "assets", "parkiran-assets.json");

// The archive is read raw, not through `tar -t`: macOS tar hides the `._*` sidecars it adds itself, so this is the
// listing CI on Linux sees.
describe("committed asset archive", () => {
  test.skipIf(!existsSync(ARCHIVE))("holds exactly the manifest's regular files, no macOS sidecars, and unpacks on Linux too", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as { files: Record<string, string> };
    const entries = listTarGz(readFileSync(ARCHIVE));
    const sidecars = entries.filter((e) => isAppleDouble(e.name)).map((e) => e.name);
    expect(sidecars).toEqual([]);
    expect(entries.every((e) => e.type === "-")).toBe(true);
    expect(entries.map((e) => e.name).sort()).toEqual(Object.keys(manifest.files).sort());
  });
});
