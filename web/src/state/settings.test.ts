import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS, applySettings, chimeEveryMs, inQuietHours, parseSettings } from "./settings.ts";

const at = (hh: number, mm = 0) => new Date(2026, 9, 10, hh, mm);

describe("settings", () => {
  test("nothing stored, or garbage stored, gives the defaults", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("not json")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("[1,2]")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('"saver"')).toEqual(DEFAULT_SETTINGS);
  });

  test("valid fields are kept, bad ones fall back one by one, unknown keys are dropped", () => {
    const s = parseSettings(
      JSON.stringify({
        power: "saver",
        cart: "sometimes",
        traffic: false,
        habits: "cigars",
        volume: 3,
        chimeRepeat: "60s",
        quietHours: { on: true, from: "25:00", to: "06:30" },
        cues: { cart: false, chime: false },
        extra: 1,
      }),
    );
    expect(s).toEqual({
      ...DEFAULT_SETTINGS,
      power: "saver",
      traffic: false,
      volume: 1,
      chimeRepeat: "60s",
      quietHours: { on: true, from: "22:00", to: "06:30" },
      cues: { ...DEFAULT_SETTINGS.cues, cart: false },
    });
    expect("extra" in s).toBe(false);
    expect(parseSettings(JSON.stringify({ volume: -2 })).volume).toBe(0);
    expect(parseSettings(JSON.stringify({ volume: 0.35 })).volume).toBe(0.35);
  });

  test("the old on/off name-tag switch becomes the new choice", () => {
    expect(parseSettings(JSON.stringify({ nameTags: true })).nameTags).toBe("full");
    expect(parseSettings(JSON.stringify({ nameTags: false })).nameTags).toBe("off");
    expect(parseSettings(JSON.stringify({ nameTags: "name" })).nameTags).toBe("name");
    expect(parseSettings(JSON.stringify({ nameTags: "huge" })).nameTags).toBe("full");
  });

  test("a change replaces fields and merges sounds and quiet hours, without touching the original", () => {
    const next = applySettings(DEFAULT_SETTINGS, { cart: "allDay", cues: { lighter: false }, quietHours: { on: true } });
    expect(next.cart).toBe("allDay");
    expect(next.cues).toEqual({ ...DEFAULT_SETTINGS.cues, lighter: false });
    expect(next.quietHours).toEqual({ ...DEFAULT_SETTINGS.quietHours, on: true });
    expect(DEFAULT_SETTINGS.cues.lighter).toBe(true);
    expect(DEFAULT_SETTINGS.quietHours.on).toBe(false);
    expect(parseSettings(JSON.stringify(next))).toEqual(next);
  });
});

describe("quiet hours", () => {
  const night = { on: true, from: "22:00", to: "07:00" };

  test("a window past midnight covers the late evening and the early morning", () => {
    expect(inQuietHours(at(21, 59), night)).toBe(false);
    expect(inQuietHours(at(22, 0), night)).toBe(true);
    expect(inQuietHours(at(3, 0), night)).toBe(true);
    expect(inQuietHours(at(6, 59), night)).toBe(true);
    expect(inQuietHours(at(7, 0), night)).toBe(false);
  });

  test("a daytime window, an empty one and a switched-off one", () => {
    const lunch = { on: true, from: "12:00", to: "13:00" };
    expect(inQuietHours(at(12, 30), lunch)).toBe(true);
    expect(inQuietHours(at(13, 0), lunch)).toBe(false);
    expect(inQuietHours(at(12, 0), { on: true, from: "12:00", to: "12:00" })).toBe(false);
    expect(inQuietHours(at(23, 0), { ...night, on: false })).toBe(false);
  });

  test("chime repeat choices", () => {
    expect(chimeEveryMs("25s")).toBe(25_000);
    expect(chimeEveryMs("60s")).toBe(60_000);
    expect(chimeEveryMs("once")).toBeNull();
  });
});
