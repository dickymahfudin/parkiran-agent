import { describe, expect, test } from "bun:test";
import { sameTag, trimTag, type TagInfo } from "./tags.ts";

const FULL: TagInfo = { title: "parkiran-agent 2", subtitle: "feat/settings", color: "#f0b429", text: "needs you", icon: "permission" };

describe("name tags", () => {
  test("off shows no tag, name only the title and the colour dot, full everything", () => {
    expect(trimTag(FULL, "off")).toBeNull();
    expect(trimTag(FULL, "name")).toEqual({ title: "parkiran-agent 2", subtitle: null, color: "#f0b429", text: null, icon: null });
    expect(trimTag(FULL, "full")).toBe(FULL);
    for (const mode of ["off", "name", "full"] as const) expect(trimTag(null, mode)).toBeNull();
  });

  test("with names only, a change of state leaves the tag the same (no re-render)", () => {
    const later: TagInfo = { ...FULL, text: "working", icon: "done" };
    expect(sameTag(trimTag(FULL, "name"), trimTag(later, "name"))).toBe(true);
    expect(sameTag(trimTag(FULL, "full"), trimTag(later, "full"))).toBe(false);
    expect(sameTag(trimTag(FULL, "name"), trimTag({ ...FULL, title: "other" }, "name"))).toBe(false);
  });
});
