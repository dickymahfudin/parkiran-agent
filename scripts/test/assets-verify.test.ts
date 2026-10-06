import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { badEntries, isSafeAssetPath, parseTarListing, verifyFiles } from "../assets/verify.ts";

const dir = mkdtempSync(join(tmpdir(), "parkiran-tar-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function tar(args: string[]): string {
  const r = Bun.spawnSync(["tar", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
  return r.stdout.toString();
}

function listing(archive: string) {
  return parseTarListing(tar(["-tzf", archive]), tar(["-tvzf", archive]));
}

describe("archive listing filter", () => {
  const pub = join(dir, "public");
  mkdirSync(join(pub, "assets", "sub"), { recursive: true });
  writeFileSync(join(pub, "assets", "a.txt"), "alpha");
  writeFileSync(join(pub, "assets", "sub", "b.bin"), "bravo");
  symlinkSync("a.txt", join(pub, "assets", "link.txt"));
  writeFileSync(join(dir, "escape.txt"), "outside");
  const manifest = { "assets/a.txt": sha("alpha"), "assets/sub/b.bin": sha("bravo") };
  const expected = new Set(Object.keys(manifest));

  test("a clean archive of regular files passes", () => {
    const archive = join(dir, "clean.tgz");
    tar(["-czf", archive, "-C", pub, "assets/a.txt", "assets/sub/b.bin"]);
    const entries = listing(archive);
    expect(entries).toEqual([
      { name: "assets/a.txt", type: "-" },
      { name: "assets/sub/b.bin", type: "-" },
    ]);
    expect(badEntries(entries, expected)).toEqual([]);
  });

  test("symlinks and directories are rejected by type", () => {
    const archive = join(dir, "links.tgz");
    tar(["-czf", archive, "-C", pub, "assets/link.txt", "assets/sub"]);
    const entries = listing(archive);
    expect(entries.find((e) => e.name === "assets/link.txt")?.type).toBe("l");
    expect(entries.find((e) => e.name.startsWith("assets/sub"))?.type).toBe("d");
    const reasons = badEntries(entries, expected);
    expect(reasons.some((r) => r.startsWith("assets/link.txt: not a regular file"))).toBe(true);
    expect(reasons.some((r) => r.includes("assets/sub") && r.includes("not a regular file"))).toBe(true);
  });

  test("paths that escape or are not in the manifest are rejected", () => {
    const archive = join(dir, "escape.tgz");
    tar(["-cPzf", archive, "-C", pub, "../escape.txt", "assets/a.txt"]);
    const entries = listing(archive);
    expect(entries.map((e) => e.name)).toContain("../escape.txt");
    const reasons = badEntries(entries, new Set(["assets/sub/b.bin"]));
    expect(reasons).toEqual(["../escape.txt: path escapes web/public/assets", "assets/a.txt: not listed in the manifest"]);
  });

  test("isSafeAssetPath", () => {
    expect(isSafeAssetPath("assets/x/y.glb")).toBe(true);
    for (const bad of ["assets", "assets/", "/assets/x", "assets/../x", "assets/./x", "other/x", "assets\\..\\x", "assets/a\nb"]) {
      expect(isSafeAssetPath(bad)).toBe(false);
    }
  });

  test("listings of different length are refused", () => {
    expect(() => parseTarListing("a\nb\n", "-rw-r--r-- x a\n")).toThrow(/disagree/);
  });
});

describe("verifyFiles", () => {
  const root = join(dir, "verify");
  mkdirSync(join(root, "assets"), { recursive: true });
  writeFileSync(join(root, "assets", "good.txt"), "good");
  writeFileSync(join(root, "assets", "bad.txt"), "tampered");

  test("reports missing and mismatched files, nothing for good ones", () => {
    expect(verifyFiles(root, { "assets/good.txt": sha("good") })).toEqual([]);
    const problems = verifyFiles(root, {
      "assets/good.txt": sha("good"),
      "assets/bad.txt": sha("original"),
      "assets/gone.txt": sha("x"),
    });
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/^assets\/bad\.txt: sha256 /);
    expect(problems[1]).toBe("assets/gone.txt: missing");
  });
});
