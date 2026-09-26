import { describe, expect, test } from "bun:test";
import { sunPosition } from "../../../../shared/src/sun.ts";
import { kelvinToRgb, lightingFor } from "./dayNight.ts";

const at = (hhmm: string) => lightingFor(sunPosition(new Date(`2026-10-09T${hhmm}:00+07:00`), -6.2, 106.8));

describe("lightingFor (Jakarta, 9 Oct)", () => {
  test("07:00 soft morning: morning sky blending to noon, warm low sun, lamps off", () => {
    const l = at("07:00");
    expect(l.sky.a).toBe("morning");
    expect(l.key.intensity).toBeGreaterThan(1.5);
    expect(l.key.color[2]).toBeLessThan(l.key.color[0]);
    expect(l.lamps).toBe(0);
  });

  test("12:00 harsh noon: noon sky, strongest neutral sun", () => {
    const l = at("12:00");
    expect(l.sky).toEqual({ a: "noon", b: "noon", t: 0 });
    expect(l.key.intensity).toBeGreaterThan(3.3);
    expect(l.key.color[2]).toBeGreaterThan(0.8);
    expect(l.night).toBe(0);
  });

  test("17:30 golden hour: golden sky, low warm sun, lamps starting", () => {
    const l = at("17:30");
    expect(l.sky.a === "golden" || l.sky.b === "golden").toBe(true);
    expect(l.key.color[2]).toBeLessThan(0.6);
    expect(l.lamps).toBeGreaterThan(0);
  });

  test("21:00 night: moon key light, lamps on, fog up", () => {
    const l = at("21:00");
    expect(l.sky.a).toBe("night");
    expect(l.lamps).toBe(1);
    expect(l.night).toBe(1);
    expect(l.key.color).toEqual([0.62, 0.72, 1.0]);
    expect(l.fogDensity).toBeGreaterThan(0.02);
  });

  test("changes continuously through the day (no jumps a viewer would notice)", () => {
    let prev = at("00:00");
    for (let m = 5; m < 24 * 60; m += 5) {
      const hhmm = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      const l = at(hhmm);
      expect(Math.abs(l.lamps - prev.lamps)).toBeLessThan(0.2);
      expect(Math.abs(l.skyIntensity - prev.skyIntensity)).toBeLessThan(0.12);
      prev = l;
    }
  });

  test("kelvin colours are warm at low temperature and neutral near daylight", () => {
    const warm = kelvinToRgb(1900);
    const day = kelvinToRgb(6500);
    expect(warm[0]).toBe(1);
    expect(warm[2]).toBeLessThan(0.2);
    expect(day[2]).toBeGreaterThan(0.95);
  });
});
