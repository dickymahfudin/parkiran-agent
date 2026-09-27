import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPTS = join(import.meta.dir, "..");
const dir = mkdtempSync(join(tmpdir(), "parkiran-cli-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function run(script: string, answer: string, settings: string) {
  const proc = Bun.spawn([process.execPath, join(SCRIPTS, script), `--settings=${settings}`], {
    stdin: new TextEncoder().encode(`${answer}\n`),
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      PARKIRAN_ENV_FILE: join(dir, ".env"),
      PARKIRAN_MANIFEST_FILE: join(dir, "manifest.json"),
    },
  });
  const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code, out, err };
}

describe("install-hooks / uninstall-hooks CLI", () => {
  test("install then uninstall leaves the fixture byte-identical", async () => {
    const settings = join(dir, "settings.json");
    copyFileSync(join(import.meta.dir, "fixtures", "user-like.json"), settings);
    const original = readFileSync(settings);

    const install = await run("install-hooks.ts", "y", settings);
    expect(install.code).toBe(0);
    expect(readFileSync(settings).equals(original)).toBe(false);
    expect(statSync(settings).mode & 0o777).toBe(0o644);
    const env = readFileSync(join(dir, ".env"), "utf8");
    expect(env).toMatch(/^PARKIRAN_TOKEN=[0-9a-f]{64}$/m);
    expect(install.out).not.toContain(env.match(/PARKIRAN_TOKEN=(\w+)/)![1]!);
    expect(statSync(join(dir, ".env")).mode & 0o777).toBe(0o600);

    const uninstall = await run("uninstall-hooks.ts", "y", settings);
    expect(uninstall.code).toBe(0);
    expect(readFileSync(settings).equals(original)).toBe(true);
    expect(existsSync(join(dir, "manifest.json"))).toBe(false);
  });

  test("answering no writes nothing", async () => {
    const settings = join(dir, "settings-no.json");
    copyFileSync(join(import.meta.dir, "fixtures", "no-hooks.json"), settings);
    const original = readFileSync(settings);
    const res = await run("install-hooks.ts", "n", settings);
    expect(res.code).toBe(1);
    expect(readFileSync(settings).equals(original)).toBe(true);
  });

  test("non-canonical settings are refused without --allow-reformat", async () => {
    const settings = join(dir, "settings-compact.json");
    copyFileSync(join(import.meta.dir, "fixtures", "compact-non-canonical.json"), settings);
    const original = readFileSync(settings);
    const res = await run("install-hooks.ts", "y", settings);
    expect(res.code).toBe(1);
    expect(res.err).toContain("--allow-reformat");
    expect(readFileSync(settings).equals(original)).toBe(true);
  });
});
