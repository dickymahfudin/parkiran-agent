import { describe, expect, test } from "bun:test";
import type { PublicSession } from "../../../shared/src/protocol.ts";
import { cueLine, formatAge, moodCounts, stateLabel } from "./labels.ts";

const session = (over: Partial<PublicSession>): PublicSession =>
  ({ id: "s", phase: "idle", work: "other", need: null, dozing: false, lastOutcome: null, subagents: {}, ...over }) as unknown as PublicSession;

describe("labels", () => {
  test("plain facts read in English, the smoking jokes stay", () => {
    expect(cueLine({ kind: "arrived", sessionId: "s" }).text).toBe("session started");
    expect(cueLine({ kind: "leaving", sessionId: "s" }).text).toBe("session ended");
    expect(cueLine({ kind: "needResolved", sessionId: "s", outcome: "denied" }).text).toBe("batal ngerokok (denied)");
    expect(stateLabel(session({ need: { kind: "permission" } as PublicSession["need"] }), 0).text).toBe("permission");
  });

  test("states and events carry an icon instead of an emoji", () => {
    expect(stateLabel(session({ need: { kind: "permission" } as PublicSession["need"] }), 0).icon).toBe("permission");
    expect(stateLabel(session({ phase: "compacting" }), 0)).toEqual({ text: "compacting", mood: "working", icon: "coffee" });
    expect(cueLine({ kind: "needResolved", sessionId: "s", outcome: "approved" }).icon).toBe("approved");
  });

  test("a reminder only talks about the lighter when the session waits on a permission", () => {
    const reminder = { kind: "needReminder", sessionId: "s" } as const;
    expect(cueLine(reminder, { need: { kind: "permission" } as PublicSession["need"] }).text).toContain("korek");
    expect(cueLine(reminder, { need: { kind: "question" } as PublicSession["need"] }).text).toBe("still waiting");
  });

  test("ages use English units", () => {
    expect(formatAge(2000)).toBe("now");
    expect(formatAge(42_000)).toBe("42s");
    expect(formatAge(5 * 60_000)).toBe("5m");
    expect(formatAge(125 * 60_000)).toBe("2h 5m");
  });

  test("the summary counts sessions per mood, needs first", () => {
    const counts = moodCounts([session({ phase: "working" }), session({}), session({ need: { kind: "input" } as PublicSession["need"] }), session({})], 0);
    expect(counts).toEqual([
      { mood: "needs", count: 1 },
      { mood: "working", count: 1 },
      { mood: "idle", count: 2 },
    ]);
  });
});
