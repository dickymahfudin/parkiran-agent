import { describe, expect, test } from "bun:test";
import { formatSpan, timelineSegments, timelineTotals, toolMixRows, waitedTotal } from "./insights.ts";

const M = 60_000;

describe("session insights", () => {
  test("the last hour as segments: cut at the window start, the open stretch runs to now", () => {
    const now = 120 * M;
    const segs = timelineSegments(
      [
        { state: "idle", at: 0 },
        { state: "working", at: 90 * M },
        { state: "waiting", at: 100 * M },
        { state: "working", at: 105 * M },
      ],
      now,
    );
    expect(segs.map((s) => [s.state, s.ms / M])).toEqual([
      ["idle", 30],
      ["working", 10],
      ["waiting", 5],
      ["working", 15],
    ]);
    expect(segs[0]!.start).toBe(0);
    expect(segs.at(-1)!.start + segs.at(-1)!.width).toBeCloseTo(1);
    expect(timelineTotals(segs)).toEqual([
      { state: "working", ms: 25 * M },
      { state: "waiting", ms: 5 * M },
      { state: "idle", ms: 30 * M },
    ]);
  });

  test("a session younger than the window starts where it started", () => {
    const segs = timelineSegments([{ state: "working", at: 50 * M }], 60 * M);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.start).toBeCloseTo(50 / 60);
  });

  test("waiting time counts the need still open", () => {
    expect(waitedTotal({ waitedMs: 30_000, need: null }, 0)).toBe(30_000);
    expect(waitedTotal({ waitedMs: 30_000, need: { since: 100_000 } as never }, 160_000)).toBe(90_000);
  });

  test("tool mix: biggest first, with shares", () => {
    const rows = toolMixRows({ read: 6, edit: 3, mcp: 1, bash: 0 });
    expect(rows.map((r) => [r.label, r.count])).toEqual([
      ["read", 6],
      ["edit", 3],
      ["MCP", 1],
    ]);
    expect(rows[0]!.share).toBeCloseTo(0.6);
    expect(toolMixRows({})).toEqual([]);
  });

  test("spans read short", () => {
    expect(formatSpan(42_000)).toBe("42s");
    expect(formatSpan(12 * M)).toBe("12m");
    expect(formatSpan(65 * M)).toBe("1h 5m");
  });
});
