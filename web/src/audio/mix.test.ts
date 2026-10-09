import { describe, expect, test } from "bun:test";
import { DUCK_LEVEL, KEYS_PER_TYPIST, MAX_KEYS_PER_S, ambienceLevel, keysPerSecond } from "./mix.ts";

describe("sound mix rules", () => {
  test("one typist is heard as is, a crowd is capped for the whole lot", () => {
    expect(keysPerSecond(0)).toBe(0);
    expect(keysPerSecond(1)).toBe(KEYS_PER_TYPIST);
    expect(keysPerSecond(2)).toBe(MAX_KEYS_PER_S);
    expect(keysPerSecond(6)).toBe(MAX_KEYS_PER_S);
  });

  test("ambience is full in front, ducked in the background, silent when off", () => {
    expect(ambienceLevel(true, false)).toBe(1);
    expect(ambienceLevel(true, true)).toBe(DUCK_LEVEL);
    expect(ambienceLevel(false, false)).toBe(0);
    expect(ambienceLevel(false, true)).toBe(0);
  });
});
