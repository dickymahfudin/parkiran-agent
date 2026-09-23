import { describe, expect, test } from "bun:test";
import { extractUsage } from "../src/statusline.ts";

describe("statusLine probe", () => {
  test("extracts only the rate limit numbers", () => {
    expect(
      extractUsage({
        cwd: "/Users/someone/secret",
        rate_limits: { five_hour: { used_percentage: 23.5, resets_at: 1738425600 }, seven_day: { used_percentage: 41.2 } },
      }),
    ).toEqual({ fiveHour: { usedPercentage: 23.5, resetsAt: 1738425600 }, sevenDay: { usedPercentage: 41.2, resetsAt: null } });
  });

  test("missing or malformed windows give null", () => {
    expect(extractUsage({})).toEqual({ fiveHour: null, sevenDay: null });
    expect(extractUsage({ rate_limits: { five_hour: { used_percentage: "50" } } })).toEqual({ fiveHour: null, sevenDay: null });
    expect(extractUsage(null)).toEqual({ fiveHour: null, sevenDay: null });
  });
});
