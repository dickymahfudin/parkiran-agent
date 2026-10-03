import { describe, expect, test } from "bun:test";
import { SEAT_PLACES } from "../layout.ts";
import { BUTT_EVERY_MS, MAX_BUTTS, MAX_CUPS, traceCounts, traceSpot } from "./traces.ts";

describe("traces by the seat", () => {
  test("butts pile up with time in the lot, a glass per compaction, both capped", () => {
    expect(traceCounts({ startedAt: 0, compactions: 0 }, BUTT_EVERY_MS - 1)).toEqual({ butts: 0, cups: 0 });
    expect(traceCounts({ startedAt: 0, compactions: 2 }, 3 * BUTT_EVERY_MS)).toEqual({ butts: 3, cups: 2 });
    expect(traceCounts({ startedAt: 0, compactions: 99 }, 999 * BUTT_EVERY_MS)).toEqual({ butts: MAX_BUTTS, cups: MAX_CUPS });
  });

  test("every seat has a spot clear of its sitter: on the bench's free end, else on the ground", () => {
    for (const [id, seat] of Object.entries(SEAT_PLACES)) {
      const spot = traceSpot(id)!;
      expect(spot).not.toBeNull();
      const [x, y, z] = spot.at;
      expect(Math.hypot(x - seat.hip[0], z - seat.hip[2])).toBeGreaterThan(0.3);
      expect(y).toBe(seat.style === "bench" ? 0.47 : 0);
    }
    expect(traceSpot("nope")).toBeNull();
  });
});
