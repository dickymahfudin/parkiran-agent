import { describe, expect, test } from "bun:test";
import type { PublicSession } from "../../../shared/src/protocol.ts";
import type { Cue } from "../../../shared/src/session.ts";
import { assignTwinNumbers, cueLine, formatAge, formatToolName, moodCounts, orderSessions, sessionName, stateLabel } from "./labels.ts";

const session = (over: Partial<PublicSession>): PublicSession =>
  ({ id: "s", phase: "idle", work: "other", need: null, dozing: false, lastOutcome: null, subagents: {}, ...over }) as unknown as PublicSession;

describe("labels", () => {
  test("plain facts read in English, the smoking jokes stay", () => {
    expect(cueLine({ kind: "arrived", sessionId: "s" }).text).toBe("session started");
    expect(cueLine({ kind: "leaving", sessionId: "s" }).text).toBe("session ended");
    expect(cueLine({ kind: "needResolved", sessionId: "s", outcome: "denied" }).text).toBe("batal ngerokok (denied)");
    expect(stateLabel(session({ need: { kind: "permission" } as PublicSession["need"] }), 0).text).toBe("permission");
  });

  test("every joke is marked as such, and is part of the line", () => {
    const cues: Cue[] = [
      { kind: "needStarted", sessionId: "s", need: "permission" },
      { kind: "needResolved", sessionId: "s", outcome: "denied" },
      { kind: "needResolved", sessionId: "s", outcome: "approved" },
      { kind: "compactStarted", sessionId: "s" },
      { kind: "compactDone", sessionId: "s" },
      { kind: "milestone", sessionId: "s", milestone: "compactions", value: 2 },
    ];
    for (const cue of cues) {
      const line = cueLine(cue);
      expect(line.joke).toBeTruthy();
      expect(line.text).toContain(line.joke!);
    }
    expect(cueLine({ kind: "needReminder", sessionId: "s" }, { need: { kind: "permission" } as PublicSession["need"] }).joke).toBe("masih cari korek");
    expect(cueLine({ kind: "turnDone", sessionId: "s" }).joke).toBeUndefined();
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

  test("milestones read as plain facts (the kopi joke stays) and never count as needing you", () => {
    expect(cueLine({ kind: "milestone", sessionId: "s", milestone: "calls", value: 100 })).toEqual({
      icon: "milestone",
      text: "100 tool calls",
      mood: "working",
    });
    expect(cueLine({ kind: "milestone", sessionId: "s", milestone: "work", value: 2 }).text).toBe("2 h of work");
    expect(cueLine({ kind: "milestone", sessionId: "s", milestone: "compactions", value: 2 }).text).toBe("2nd compaction, kopi lagi");
  });

  test("the list puts sessions waiting on you first, longest waiting on top, the rest in arrival order", () => {
    const s = (id: string, startedAt: number, since?: number) =>
      ({ id, startedAt, need: since === undefined ? null : { kind: "permission", since } }) as unknown as PublicSession;
    const order = orderSessions([s("a", 1), s("b", 2, 50), s("c", 3), s("d", 4, 20)]).map((x) => x.id);
    expect(order).toEqual(["d", "b", "a", "c"]);
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

  test("MCP tool names read as server › tool; built-in tools stay as they are", () => {
    expect(formatToolName("mcp__Claude_Browser__javascript_tool")).toBe("Claude Browser › javascript_tool");
    expect(formatToolName("mcp__plugin_context-mode_context-mode__ctx_execute")).toBe("context-mode › ctx_execute");
    expect(formatToolName("mcp__plugin_figma_desktop__get_code")).toBe("figma desktop › get_code");
    expect(formatToolName("mcp__1a59c906-04da-521d-bda7-7f71b9f9e01c__batch")).toBe("1a59c906 › batch");
    expect(formatToolName("Bash")).toBe("Bash");
    expect(formatToolName("mcp__broken")).toBe("mcp__broken");
  });

  test("twins of one project and branch get #2, #3 by start time; a lone session gets none", () => {
    const twin = (id: string, startedAt: number, project = "parkiran", branch: string | null = "main") => ({ id, project, branch, startedAt });
    const a = twin("a", 1);
    const b = twin("b", 2);
    const other = twin("o", 0, "parkiran", "dev");
    let twins = assignTwinNumbers(new Map(), [b, a, other]);
    expect([...twins]).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
    expect(sessionName(a, twins)).toBe("parkiran");
    expect(sessionName(b, twins)).toBe("parkiran #2");
    expect(sessionName({ id: "o", project: "parkiran" }, twins)).toBe("parkiran");
    // The first one leaves and a newcomer arrives: #2 keeps its number, the newcomer counts on.
    twins = assignTwinNumbers(twins, [b, twin("c", 3)]);
    expect(twins.get("b")).toBe(2);
    expect(twins.get("c")).toBe(3);
    // Left alone, the number goes.
    twins = assignTwinNumbers(twins, [b]);
    expect(twins.size).toBe(0);
    expect(sessionName(b, twins)).toBe("parkiran");
  });
});
