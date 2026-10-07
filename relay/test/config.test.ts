import { describe, expect, test } from "bun:test";
import { DEFAULT_PORT } from "../../shared/src/env.ts";
import { loadRelayConfig } from "../src/config.ts";

// Every key is given explicitly so the project's own .env (merged underneath) cannot change the outcome.
const full = { PARKIRAN_TOKEN: "t".repeat(64), PARKIRAN_PORT: "4757", PARKIRAN_GIT: "/usr/bin/git", PARKIRAN_RELAY_DEBUG: "1", PARKIRAN_RELAY_RAW: "true" };

describe("loadRelayConfig", () => {
  test("reads the token, port, git path and flags from the process env", () => {
    expect(loadRelayConfig(full)).toEqual({ token: "t".repeat(64), port: 4757, gitPath: "/usr/bin/git", debug: true, raw: true });
  });

  test("an empty token or git path is null, flags are off unless 1/true", () => {
    const c = loadRelayConfig({ ...full, PARKIRAN_TOKEN: "", PARKIRAN_GIT: "", PARKIRAN_RELAY_DEBUG: "0", PARKIRAN_RELAY_RAW: "yes" });
    expect(c.token).toBeNull();
    expect(c.gitPath).toBeNull();
    expect(c.debug).toBe(false);
    expect(c.raw).toBe(false);
  });

  test("a port that is not a valid number falls back to the default", () => {
    for (const bad of ["", "abc", "0", "70000", "-1"]) expect(loadRelayConfig({ ...full, PARKIRAN_PORT: bad }).port).toBe(DEFAULT_PORT);
  });
});
