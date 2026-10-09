import { describe, expect, test } from "bun:test";
import { CLOCK_JUMP_MS, keepSelection, nextClockOffset, pruneAcknowledged } from "./sync.ts";

describe("nextClockOffset", () => {
  test("a hello starts over; later frames may only raise the estimate", () => {
    expect(nextClockOffset(9999, 5000, true)).toBe(5000);
    expect(nextClockOffset(5000, 4800, false)).toBe(5000);
    expect(nextClockOffset(5000, 5100, false)).toBe(5100);
  });

  test("a drop larger than a clock jump is followed", () => {
    expect(nextClockOffset(5000, 5000 - CLOCK_JUMP_MS, false)).toBe(5000);
    expect(nextClockOffset(5000, 5000 - CLOCK_JUMP_MS - 1, false)).toBe(5000 - CLOCK_JUMP_MS - 1);
  });
});

describe("selection and acknowledgements", () => {
  const sessions = { a: {}, b: {} };

  test("a selection survives only while its session is in the lot", () => {
    expect(keepSelection("a", sessions)).toBe("a");
    expect(keepSelection("gone", sessions)).toBeNull();
    expect(keepSelection(null, sessions)).toBeNull();
  });

  test("acknowledgements of sessions that left are dropped", () => {
    expect(pruneAcknowledged({ a: 1, gone: 2, b: 3 }, sessions)).toEqual({ a: 1, b: 3 });
  });
});
