import { describe, expect, test } from "bun:test";
import { SceneTimeEase, TIME_EASE_MS, clockDelta, isTimeMode, modeOf, presetTime } from "./timeOfDay.ts";

const H = 60 * 60_000;

describe("time of day", () => {
  test("presets map to fixed times, auto to the local clock", () => {
    expect(presetTime("pagi")).toBe("07:00");
    expect(presetTime("siang")).toBe("12:00");
    expect(presetTime("sore")).toBe("17:30");
    expect(presetTime("malam")).toBe("21:00");
    expect(presetTime("auto")).toBeNull();
    expect(modeOf(null)).toBe("auto");
    expect(modeOf("21:00")).toBe("malam");
    expect(modeOf("03:15")).toBeNull();
  });

  test("only known modes are accepted from storage", () => {
    expect(isTimeMode("sore")).toBe(true);
    expect(isTimeMode("subuh")).toBe(false);
    expect(isTimeMode(null)).toBe(false);
  });

  test("the clock delta takes the short way round", () => {
    expect(clockDelta(10 * H)).toBe(10 * H);
    expect(clockDelta(-14 * H)).toBe(10 * H);
    expect(clockDelta(14 * H)).toBe(-10 * H);
    expect(clockDelta(24 * H)).toBe(0);
  });

  test("a new source eases over the short way; the running clock and a new day never do", () => {
    const ease = new SceneTimeEase();
    const t0 = Date.UTC(2026, 9, 9, 14);
    expect(ease.step(t0, "auto", 0)).toBe(t0);
    expect(ease.step(t0 + 1000, "auto", 1000)).toBe(t0 + 1000);
    // Auto (14:00) → Malam (21:00): starts where it was, ends on the preset.
    const malam = t0 + 7 * H;
    expect(ease.step(malam, "21:00", 2000)).toBe(t0 + 1000);
    const mid = ease.step(malam, "21:00", 2000 + TIME_EASE_MS / 2);
    expect(mid).toBeGreaterThan(t0 + 1000);
    expect(mid).toBeLessThan(malam);
    expect(ease.step(malam, "21:00", 2000 + TIME_EASE_MS)).toBe(malam);
    // A frozen preset rolling over to the next day is the same time of day: no sweep.
    expect(ease.step(malam + 24 * H, "21:00", 9000)).toBe(malam + 24 * H);
    // Malam → Pagi: forward through the night (07:00 is 10 h after 21:00), not 14 h back through the day.
    const pagi = malam - 14 * H;
    ease.step(pagi, "07:00", 10_000);
    expect(ease.step(pagi, "07:00", 10_000 + TIME_EASE_MS / 2)).toBe(pagi - 5 * H);
  });
});
