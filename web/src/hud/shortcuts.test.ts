import { describe, expect, test } from "bun:test";
import { isTypingTarget, shortcutFor } from "./shortcuts.ts";

const press = (key: string, over: Partial<Parameters<typeof shortcutFor>[0]> = {}) =>
  shortcutFor({ key, metaKey: false, ctrlKey: false, altKey: false, target: { tagName: "BUTTON" }, ...over });

describe("shortcuts", () => {
  test("',' toggles the settings and '?' shows the list", () => {
    expect(press(",")).toBe("settings");
    expect(press("?")).toBe("help");
    expect(press("x")).toBeNull();
    expect(press("r")).toBeNull();
  });

  test("never while typing in a field or an editable element", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT", "input"]) expect(press(",", { target: { tagName } })).toBeNull();
    expect(press("?", { target: { tagName: "DIV", isContentEditable: true } })).toBeNull();
    expect(press(",", { isComposing: true })).toBeNull();
  });

  test("never with a modifier other than Shift (browser and OS shortcuts stay theirs)", () => {
    expect(press(",", { metaKey: true })).toBeNull();
    expect(press(",", { ctrlKey: true })).toBeNull();
    expect(press("?", { altKey: true })).toBeNull();
  });

  test("a missing or plain target is not a field", () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget({})).toBe(false);
    expect(press(",", { target: null })).toBe("settings");
  });
});
