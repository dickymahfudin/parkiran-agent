import { describe, expect, test } from "bun:test";
import { categoriesFor, parseCategory, stepIndex, trapIndex } from "./nav.ts";

describe("settings categories", () => {
  test("Developer shows in a dev build only", () => {
    expect(categoriesFor(true).map((c) => c.id)).toEqual(["sound", "notifications", "display", "battery", "street", "developer"]);
    expect(categoriesFor(false).some((c) => c.id === "developer")).toBe(false);
  });

  test("a stored category comes back; unknown, missing or hidden ones fall back to the first", () => {
    expect(parseCategory("battery", categoriesFor(false))).toBe("battery");
    expect(parseCategory(null, categoriesFor(false))).toBe("sound");
    expect(parseCategory("nonsense", categoriesFor(true))).toBe("sound");
    expect(parseCategory("developer", categoriesFor(false))).toBe("sound");
    expect(parseCategory("developer", categoriesFor(true))).toBe("developer");
  });
});

describe("stepIndex", () => {
  test("arrows wrap around, Home and End jump to the ends", () => {
    expect(stepIndex("ArrowDown", 0, 5)).toBe(1);
    expect(stepIndex("ArrowDown", 4, 5)).toBe(0);
    expect(stepIndex("ArrowUp", 0, 5)).toBe(4);
    expect(stepIndex("ArrowUp", 3, 5)).toBe(2);
    expect(stepIndex("Home", 3, 5)).toBe(0);
    expect(stepIndex("End", 1, 5)).toBe(4);
  });

  test("other keys and empty lists are ignored", () => {
    expect(stepIndex("ArrowLeft", 1, 5)).toBeNull();
    expect(stepIndex("Enter", 1, 5)).toBeNull();
    expect(stepIndex("ArrowDown", 0, 0)).toBeNull();
  });
});

describe("trapIndex", () => {
  test("Tab on the last element goes to the first, Shift+Tab on the first to the last", () => {
    expect(trapIndex(4, 5, false)).toBe(0);
    expect(trapIndex(0, 5, true)).toBe(4);
  });

  test("in the middle the browser moves on by itself", () => {
    expect(trapIndex(2, 5, false)).toBeNull();
    expect(trapIndex(2, 5, true)).toBeNull();
    expect(trapIndex(0, 5, false)).toBeNull();
    expect(trapIndex(4, 5, true)).toBeNull();
  });

  test("focus outside the trap comes back to the first or last element", () => {
    expect(trapIndex(-1, 5, false)).toBe(0);
    expect(trapIndex(-1, 5, true)).toBe(4);
    expect(trapIndex(-1, 0, false)).toBeNull();
  });

  test("a single element keeps the focus", () => {
    expect(trapIndex(0, 1, false)).toBe(0);
    expect(trapIndex(0, 1, true)).toBe(0);
  });
});
