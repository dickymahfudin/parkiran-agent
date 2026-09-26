import { describe, expect, test } from "bun:test";
import type { PublicSession } from "../../../shared/src/protocol.ts";
import { CHIME_EVERY_MS, notificationTitle, shouldChime } from "./rules.ts";

const base = {
  id: "abc",
  project: "warung-app",
  branch: "main",
  need: { kind: "permission", toolName: "Bash", toolUseId: null, agentId: null, since: 1000, reminded: false },
} as unknown as PublicSession;

describe("notifier", () => {
  test("titles follow the brief", () => {
    expect(notificationTitle(base)).toBe("warung-app butuh korek 🔥");
    expect(notificationTitle({ ...base, need: { ...base.need!, kind: "question" } })).toBe("warung-app nanya ❓");
  });

  test("chimes on a new need, repeats, and stops once acknowledged or resolved", () => {
    expect(shouldChime(base, undefined, undefined, 1500)).toBe(true);
    expect(shouldChime(base, undefined, 1500, 1500 + CHIME_EVERY_MS - 1)).toBe(false);
    expect(shouldChime(base, undefined, 1500, 1500 + CHIME_EVERY_MS)).toBe(true);
    expect(shouldChime(base, 1000, 1500, 99_999)).toBe(false);
    expect(shouldChime({ ...base, need: null }, undefined, undefined, 2000)).toBe(false);
  });

  test("an acknowledgement of an older need does not silence a new one", () => {
    const later = { ...base, need: { ...base.need!, since: 50_000 } };
    expect(shouldChime(later, 1000, 40_000, 50_100)).toBe(true);
  });
});
