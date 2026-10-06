import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPTS = join(import.meta.dir, "..");
const dir = mkdtempSync(join(tmpdir(), "parkiran-cli-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const backups = (where: string) => readdirSync(where).filter((n) => n.startsWith("settings.json.") && n.endsWith(".bak"));

async function run(script: string, answer: string, settings: string, extraEnv: Record<string, string | undefined> = {}) {
  const proc = Bun.spawn([process.execPath, join(SCRIPTS, script), `--settings=${settings}`], {
    stdin: new TextEncoder().encode(`${answer}\n`),
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      PARKIRAN_ENV_FILE: join(dir, ".env"),
      PARKIRAN_MANIFEST_FILE: join(dir, "manifest.json"),
      ...extraEnv,
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
    expect(statSync(dir).mode & 0o777).toBe(0o700);

    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as Record<string, unknown>;
    expect(manifest.originalSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.installedSha256).toMatch(/^[0-9a-f]{64}$/);
    const afterInstall = backups(dir);
    expect(afterInstall).toHaveLength(1);
    expect(readFileSync(join(dir, afterInstall[0]!)).equals(original)).toBe(true);
    expect(statSync(join(dir, afterInstall[0]!)).mode & 0o777).toBe(0o600);
    expect(install.out).toContain(afterInstall[0]!);

    const uninstall = await run("uninstall-hooks.ts", "y", settings);
    expect(uninstall.code).toBe(0);
    expect(uninstall.out).not.toContain("!");
    expect(readFileSync(settings).equals(original)).toBe(true);
    expect(existsSync(join(dir, "manifest.json"))).toBe(false);
    const afterUninstall = backups(dir);
    expect(afterUninstall).toHaveLength(2);
    const newest = afterUninstall.filter((n) => n !== afterInstall[0])[0]!;
    expect(readFileSync(join(dir, newest), "utf8")).toContain("--parkiran-relay");
    for (const b of afterUninstall) rmSync(join(dir, b));
  });

  test("a pre-existing 0644 .env is tightened to 0600", async () => {
    const envPath = join(dir, ".env-loose");
    writeFileSync(envPath, `PARKIRAN_TOKEN=${"a".repeat(64)}\nPARKIRAN_PORT=4747\nPARKIRAN_GIT=/usr/bin/git\n`, { mode: 0o644 });
    chmodSync(envPath, 0o644);
    expect(statSync(envPath).mode & 0o777).toBe(0o644);
    const settings = join(dir, "settings-env.json");
    copyFileSync(join(import.meta.dir, "fixtures", "no-hooks.json"), settings);
    const res = await run("install-hooks.ts", "y", settings, { PARKIRAN_ENV_FILE: envPath, PARKIRAN_MANIFEST_FILE: join(dir, "m-env.json") });
    expect(res.code).toBe(0);
    expect(statSync(envPath).mode & 0o777).toBe(0o600);
    expect(readFileSync(envPath, "utf8")).toMatch(/^PARKIRAN_TOKEN=a{64}\n/);
  });

  test("a lost manifest never deletes the user's own containers", async () => {
    const manifestPath = join(dir, "m-lost.json");
    const settings = join(dir, "settings-lost.json");
    copyFileSync(join(import.meta.dir, "fixtures", "four-space-empty-stop.json"), settings);
    const original = readFileSync(settings);
    const install = await run("install-hooks.ts", "y", settings, { PARKIRAN_MANIFEST_FILE: manifestPath });
    expect(install.code).toBe(0);
    rmSync(manifestPath);

    const uninstall = await run("uninstall-hooks.ts", "y", settings, { PARKIRAN_MANIFEST_FILE: manifestPath });
    expect(uninstall.code).toBe(0);
    expect(uninstall.out).toContain(`${manifestPath} is missing`);
    expect(uninstall.out).toContain("Only Parkiran's handlers will be removed");
    // Not byte-identical (the containers install created cannot be proven ours any more), but nothing of the user's is gone.
    const after = readFileSync(settings, "utf8");
    expect(after).not.toContain("--parkiran-relay");
    const parsed = JSON.parse(after) as { theme: string; hooks: Record<string, unknown[]> };
    expect(parsed.theme).toBe("dark");
    expect(parsed.hooks.Stop).toEqual([]);
    expect(Object.values(parsed.hooks).every((g) => g.length === 0)).toBe(true);
    expect(original.toString()).toContain('"Stop": []');
  });

  test("a malformed manifest is reported and treated like a lost one", async () => {
    const manifestPath = join(dir, "m-bad.json");
    const settings = join(dir, "settings-bad-manifest.json");
    copyFileSync(join(import.meta.dir, "fixtures", "four-space-empty-stop.json"), settings);
    const original = readFileSync(settings);
    expect((await run("install-hooks.ts", "y", settings, { PARKIRAN_MANIFEST_FILE: manifestPath })).code).toBe(0);
    writeFileSync(manifestPath, "{ not json");

    const uninstall = await run("uninstall-hooks.ts", "y", settings, { PARKIRAN_MANIFEST_FILE: manifestPath });
    expect(uninstall.code).toBe(0);
    expect(uninstall.out).toContain(`${manifestPath} is malformed`);
    const after = readFileSync(settings, "utf8");
    expect(after).not.toContain("--parkiran-relay");
    expect((JSON.parse(after) as { hooks: { Stop: unknown[] } }).hooks.Stop).toEqual([]);
    expect(original.toString()).toContain('"Stop": []');
  });

  test("the manifest is written before settings.json", async () => {
    // A read-only settings directory makes the settings write fail; the manifest must already be there.
    const roDir = join(dir, "ro");
    const manifestPath = join(dir, "m-ro.json");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(roDir);
    const settings = join(roDir, "settings.json");
    copyFileSync(join(import.meta.dir, "fixtures", "no-hooks.json"), settings);
    chmodSync(roDir, 0o500);
    try {
      const res = await run("install-hooks.ts", "y", settings, { PARKIRAN_MANIFEST_FILE: manifestPath });
      expect(res.code).not.toBe(0);
      expect(existsSync(manifestPath)).toBe(true);
    } finally {
      chmodSync(roDir, 0o700);
    }
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

describe("doctor CLI", () => {
  test("reports every check and warns (not fails) when the server is down", async () => {
    const manifestPath = join(dir, "m-doctor.json");
    const envPath = join(dir, ".env-doctor");
    const settings = join(dir, "settings-doctor.json");
    copyFileSync(join(import.meta.dir, "fixtures", "user-like.json"), settings);
    const env = { PARKIRAN_ENV_FILE: envPath, PARKIRAN_MANIFEST_FILE: manifestPath };
    expect((await run("install-hooks.ts", "y", settings, env)).code).toBe(0);

    // Grab an ephemeral port and close it again so the health check is refused.
    const probe = Bun.serve({ port: 0, fetch: () => new Response("") });
    const closedPort = probe.port!;
    probe.stop(true);

    const res = await run("doctor.ts", "", settings, { ...env, PARKIRAN_PORT: String(closedPort) });
    expect(res.code).toBe(0);
    expect(res.out).toMatch(/^ok {4}settings/m);
    expect(res.out).toMatch(/^ok {4}bun/m);
    expect(res.out).toMatch(/^ok {4}relay/m);
    expect(res.out).toMatch(/^ok {4}events/m);
    expect(res.out).toMatch(/^ok {4}\.env {6}PARKIRAN_TOKEN present/m);
    expect(res.out).toMatch(/^ok {4}\.env {6}mode 0600/m);
    expect(res.out).toMatch(/^ok {4}manifest/m);
    expect(res.out).toMatch(new RegExp(`^warn  server {4}server not running on port ${closedPort}`, "m"));
    expect(res.out).toMatch(/^(ok|warn) +web /m);

    rmSync(settings);
    const missing = await run("doctor.ts", "", settings, env);
    expect(missing.code).toBe(1);
    expect(missing.out).toMatch(/^fail  settings/m);
  });
});

describe("simulate CLI", () => {
  const simulate = async (...flags: string[]) => {
    const proc = Bun.spawn([process.execPath, join(SCRIPTS, "simulate.ts"), ...flags], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PARKIRAN_PORT: undefined, PARKIRAN_SIM_PORT: undefined },
    });
    const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    return { code, out, err };
  };

  test("refuses to run without a port, and never falls back to the live lot", async () => {
    const r = await simulate("--scenario=working");
    expect(r.code).toBe(1);
    expect(r.err).toContain("--port=");
    expect(r.out).not.toContain("simulating");
  });

  test("refuses the live port unless --live is passed", async () => {
    const r = await simulate("--scenario=working", "--port=4747");
    expect(r.code).toBe(1);
    expect(r.err).toContain("live lot");
    expect(r.out).not.toContain("simulating");
  });

  test("rejects a zero or negative speed", async () => {
    const r = await simulate("--scenario=working", "--port=4757", "--speed=0");
    expect(r.code).toBe(1);
    expect(r.err).toContain("--speed");
  });

  test("--list needs no port", async () => {
    const r = await simulate("--list");
    expect(r.code).toBe(0);
    expect(r.out).toContain("tour");
  });
});
