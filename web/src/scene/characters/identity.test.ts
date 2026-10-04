import { describe, expect, test } from "bun:test";
import { accessoryFor, habitFor, lookFor } from "./identity.ts";

describe("identity", () => {
  test("habits: about 70 % kretek, 25 % vape, 5 % no smoking, the same for the same session", () => {
    const counts = { kretek: 0, vape: 0, none: 0 };
    for (let i = 0; i < 4000; i++) counts[habitFor(`session-${i}`)]++;
    expect(counts.kretek / 4000).toBeCloseTo(0.7, 1);
    expect(counts.vape / 4000).toBeCloseTo(0.25, 1);
    expect(counts.none / 4000).toBeCloseTo(0.05, 1);
    expect(lookFor("abc").habit).toBe(habitFor("abc"));
  });

  test("accessories per session: about 10 % peci, 30 % glasses, the rest nothing; a peci never sits under a cap", () => {
    const counts = { peci: 0, glasses: 0, none: 0 };
    for (let i = 0; i < 4000; i++) {
      const look = lookFor(`s-${i}`);
      counts[look.accessory ?? "none"]++;
      if (look.accessory === "peci") expect(look.cap).toBeNull();
    }
    expect(counts.peci / 4000).toBeCloseTo(0.1, 1);
    expect(counts.glasses / 4000).toBeCloseTo(0.3, 1);
    expect(counts.none / 4000).toBeCloseTo(0.6, 1);
    expect(lookFor("abc").accessory).toBe(accessoryFor("abc"));
  });
});
