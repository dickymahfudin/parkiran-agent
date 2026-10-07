import { describe, expect, test } from "bun:test";
import { HOOK_EVENTS } from "../../shared/src/events.ts";
import { checkEnv, checkHandlers, checkHealth, checkManifest, checkSettings, checkWebBuild, exitCode, resolvePort } from "../lib/doctor.ts";
import { parseSettings, planInstall, type Json } from "../lib/settings-hooks.ts";

const target = { bunPath: "/opt/bun/bin/bun", relayPath: "/repo/relay/src/index.ts" };
const installed = () => parseSettings(planInstall("{}\n", target, null).newText);
const allFiles = { exists: () => true, executable: () => true };

describe("doctor checks", () => {
  test("settings must exist and parse", () => {
    expect(checkSettings("/x/settings.json", null).check.status).toBe("fail");
    expect(checkSettings("/x/settings.json", "{ nope").check.status).toBe("fail");
    expect(checkSettings("/x/settings.json", "{}\n").check.status).toBe("ok");
  });

  test("a healthy install is all ok", () => {
    const checks = checkHandlers(installed(), allFiles);
    expect(checks.map((c) => c.status)).toEqual(["ok", "ok", "ok"]);
    expect(checks[2]!.detail).toContain(String(HOOK_EVENTS.length));
  });

  test("missing bun or relay fails and names the path", () => {
    const noBun = checkHandlers(installed(), { exists: () => true, executable: () => false });
    expect(noBun.find((c) => c.item === "bun")).toMatchObject({ status: "fail" });
    expect(noBun.find((c) => c.item === "bun")!.detail).toContain(target.bunPath);
    const noRelay = checkHandlers(installed(), { exists: () => false, executable: () => true });
    expect(noRelay.find((c) => c.item === "relay")).toMatchObject({ status: "fail" });
  });

  test("no handlers, a missing event or a duplicate fails", () => {
    expect(checkHandlers(parseSettings("{}\n"), allFiles)[0]!.status).toBe("fail");
    const settings = installed();
    const hooks = settings.hooks as Record<string, Json[]>;
    delete hooks.Stop;
    hooks.PreToolUse!.push(structuredClone(hooks.PreToolUse![0]!));
    const events = checkHandlers(settings, allFiles).find((c) => c.item === "events")!;
    expect(events.status).toBe("fail");
    expect(events.detail).toContain("Stop=0");
    expect(events.detail).toContain("PreToolUse=2");
  });

  test(".env needs a long token and mode 0600", () => {
    expect(checkEnv("/r/.env", null, null).checks[0]!.status).toBe("fail");
    const short = checkEnv("/r/.env", "PARKIRAN_TOKEN=abc\n", 0o100600).checks;
    expect(short[0]!.status).toBe("fail");
    const loose = checkEnv("/r/.env", `PARKIRAN_TOKEN=${"a".repeat(64)}\nPARKIRAN_PORT=4999\n`, 0o100644);
    expect(loose.checks.map((c) => c.status)).toEqual(["ok", "warn"]);
    expect(loose.checks[1]!.detail).toContain("0644");
    expect(loose.env.PARKIRAN_PORT).toBe("4999");
    expect(checkEnv("/r/.env", `PARKIRAN_TOKEN=${"a".repeat(16)}\n`, 0o100600).checks.map((c) => c.status)).toEqual(["ok", "ok"]);
  });

  test("manifest problems are warnings that mention the file", () => {
    const warn = checkManifest({ manifest: null, problem: "/r/.parkiran/hooks-install.json is missing" }, "/r/.parkiran/hooks-install.json");
    expect(warn.status).toBe("warn");
    expect(warn.detail).toContain("hooks-install.json is missing");
    const ok = checkManifest({ manifest: { settingsPath: "/s", createdPaths: [], createdFile: false }, problem: null }, "/m");
    expect(ok.status).toBe("ok");
  });

  test("port comes from the process env, then .env, then the default", () => {
    expect(resolvePort({ PARKIRAN_PORT: "5000" }, { PARKIRAN_PORT: "6000" }, 4747)).toBe(5000);
    expect(resolvePort({}, { PARKIRAN_PORT: "6000" }, 4747)).toBe(6000);
    expect(resolvePort({}, { PARKIRAN_PORT: "nope" }, 4747)).toBe(4747);
  });

  test("health: refused is a warning, a bad answer is a failure, ok is ok", async () => {
    const refused = Object.assign(new Error("Unable to connect"), { code: "ECONNREFUSED" });
    const asFetch = (fn: (url: string) => Promise<Response>) => fn as unknown as typeof fetch;
    expect(
      (
        await checkHealth(
          1,
          asFetch(async () => {
            throw refused;
          }),
        )
      ).status,
    ).toBe("warn");
    expect(
      (
        await checkHealth(
          1,
          asFetch(async () => new Response("x", { status: 500 })),
        )
      ).status,
    ).toBe("fail");
    expect(
      (
        await checkHealth(
          1,
          asFetch(async () => Response.json({ ok: false })),
        )
      ).status,
    ).toBe("fail");
    const ok = await checkHealth(
      1,
      asFetch(async () => Response.json({ ok: true, sessions: 2 })),
    );
    expect(ok.status).toBe("ok");
    expect(ok.detail).toContain("2 sessions");
    const boom = await checkHealth(
      1,
      asFetch(async () => {
        throw new Error("TLS exploded");
      }),
    );
    expect(boom.status).toBe("fail");
  });

  test("web build missing is a warning; exit code is 1 only on fail", () => {
    expect(checkWebBuild("/w/index.html", () => false).status).toBe("warn");
    expect(checkWebBuild("/w/index.html", () => true).status).toBe("ok");
    expect(
      exitCode([
        { status: "ok", item: "a", detail: "" },
        { status: "warn", item: "b", detail: "" },
      ]),
    ).toBe(0);
    expect(
      exitCode([
        { status: "ok", item: "a", detail: "" },
        { status: "fail", item: "b", detail: "" },
      ]),
    ).toBe(1);
  });
});
