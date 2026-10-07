import { describe, expect, test } from "bun:test";
import { GIT_FALLBACKS, applyEnvAdditions, pickGit, planEnvAdditions } from "../lib/env-file.ts";

describe("PARKIRAN_GIT shim guard", () => {
  test("a real git on PATH is kept as found", () => {
    expect(pickGit("/opt/homebrew/bin/git", () => false)).toBe("/opt/homebrew/bin/git");
  });

  test("a shim is replaced by the first existing fallback", () => {
    const shim = "/Users/example/.asdf/shims/git";
    expect(pickGit(shim, (p) => p === "/opt/homebrew/bin/git")).toBe("/opt/homebrew/bin/git");
    expect(pickGit(shim, () => true)).toBe(GIT_FALLBACKS[0]);
  });

  test("a shim with no fallback, or no git at all, yields null and the key is omitted", () => {
    expect(pickGit("/Users/example/.mise/shims/git", () => false)).toBeNull();
    expect(pickGit(null, () => false)).toBeNull();
    const keys = planEnvAdditions(null, null).map((a) => a.key);
    expect(keys).toEqual(["PARKIRAN_TOKEN", "PARKIRAN_PORT"]);
  });

  test("an existing PARKIRAN_GIT is never overwritten", () => {
    const additions = planEnvAdditions("PARKIRAN_TOKEN=x\nPARKIRAN_PORT=1\nPARKIRAN_GIT=/my/git\n", "/usr/bin/git");
    expect(additions).toEqual([]);
    expect(applyEnvAdditions("A=1", [{ key: "PARKIRAN_GIT", value: "/usr/bin/git", display: "/usr/bin/git" }])).toBe("A=1\nPARKIRAN_GIT=/usr/bin/git\n");
  });
});
