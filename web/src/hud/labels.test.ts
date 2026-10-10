import { describe, expect, test } from "bun:test";
import type { PublicSession } from "../../../shared/src/protocol.ts";
import type { Cue } from "../../../shared/src/session.ts";
import {
  assignTwinNumbers,
  cueLine,
  feedBucket,
  feedSubject,
  formatAge,
  formatToolName,
  groupFeed,
  moodCounts,
  orderSessions,
  sessionName,
  stateLabel,
  unseenAttention,
} from "./labels.ts";

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

  test("a folded feed counts only the attention events that arrived after it was folded", () => {
    const entries = [
      { seq: 1, cue: { kind: "needStarted", sessionId: "s", need: "permission" } as Cue },
      { seq: 2, cue: { kind: "turnDone", sessionId: "s" } as Cue },
      { seq: 3, cue: { kind: "failure", sessionId: "s", source: "tool" } as Cue },
      { seq: 4, cue: { kind: "needResolved", sessionId: "s", outcome: "denied" } as Cue },
      { seq: 5, cue: { kind: "milestone", sessionId: "s", milestone: "calls", value: 100 } as Cue },
    ];
    expect(unseenAttention(entries, 0, {})).toBe(3);
    expect(unseenAttention(entries, 3, {})).toBe(1);
    expect(unseenAttention(entries, 5, {})).toBe(0);
  });

  test("feed sections by age: just now, each minute up to 10, then earlier", () => {
    expect(feedBucket(0)).toBe("Just now");
    expect(feedBucket(59_999)).toBe("Just now");
    expect(feedBucket(60_000)).toBe("1 min ago");
    expect(feedBucket(4 * 60_000 + 30_000)).toBe("4 min ago");
    expect(feedBucket(10 * 60_000 + 59_000)).toBe("10 min ago");
    expect(feedBucket(11 * 60_000)).toBe("Earlier");
    expect(feedBucket(5 * 3_600_000)).toBe("Earlier");
    // A clock that runs a little ahead never makes a cue "from the future".
    expect(feedBucket(-2000)).toBe("Just now");
  });

  describe("grouped feed", () => {
    const NOW = 1_000_000;
    let seq = 100;
    const entry = (cue: Cue, agoMs = 0) => ({ cue, at: NOW - agoMs, seq: seq-- });
    const done = (sessionId: string, agoMs = 0) => entry({ kind: "turnDone", sessionId }, agoMs);
    const shape = (sections: ReturnType<typeof groupFeed>) =>
      sections.map((s) => [s.label, s.groups.map((g) => `${g.line.text}|${g.sessionIds.join(",")}|${g.count}`)]);

    test("alike cues from several sessions merge into one line that counts them", () => {
      const entries = [done("a"), done("b"), done("c"), done("d")];
      const sections = groupFeed(entries, NOW, {});
      expect(shape(sections)).toEqual([["Just now", ["turn done|a,b,c,d|4"]]]);
      expect(feedSubject(sections[0]!.groups[0]!, (id) => id)).toBe("4 sessions");
      // Keyed by the newest cue, so the line is new (and animates in) whenever it gains one.
      expect(sections[0]!.groups[0]!.key).toBe(entries[0]!.seq);
    });

    test("one session repeating keeps its name and counts the repeats", () => {
      const sections = groupFeed([done("blog"), done("blog"), done("blog")], NOW, {});
      const g = sections[0]!.groups[0]!;
      expect([g.count, feedSubject(g, (id) => `${id}!`)]).toEqual([3, "blog!"]);
    });

    test("a mixed run counts sessions in the subject and cues in the badge", () => {
      const g = groupFeed([done("a"), done("a"), done("b")], NOW, {})[0]!.groups[0]!;
      expect([g.sessionIds, g.count]).toEqual([["a", "b"], 3]);
    });

    test("only consecutive cues of the same kind and outcome merge", () => {
      const sections = groupFeed(
        [
          done("a"),
          entry({ kind: "arrived", sessionId: "b" }),
          done("c"),
          entry({ kind: "needResolved", sessionId: "a", outcome: "approved" }),
          entry({ kind: "needResolved", sessionId: "b", outcome: "answered" }),
          entry({ kind: "milestone", sessionId: "a", milestone: "calls", value: 100 }),
          entry({ kind: "milestone", sessionId: "b", milestone: "calls", value: 200 }),
        ],
        NOW,
        {},
      );
      expect(sections[0]!.groups.map((g) => g.count)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    });

    test("cues that need you or went wrong are never merged", () => {
      const sections = groupFeed(
        [
          entry({ kind: "needStarted", sessionId: "a", need: "permission" }),
          entry({ kind: "needStarted", sessionId: "b", need: "permission" }),
          entry({ kind: "failure", sessionId: "a", source: "tool" }),
          entry({ kind: "failure", sessionId: "a", source: "tool" }),
          entry({ kind: "needResolved", sessionId: "a", outcome: "denied" }),
          entry({ kind: "needResolved", sessionId: "b", outcome: "denied" }),
        ],
        NOW,
        {},
      );
      expect(sections[0]!.groups).toHaveLength(6);
      expect(sections[0]!.groups.every((g) => g.count === 1)).toBe(true);
    });

    test("a run never crosses a section, and a merged line keeps its joke", () => {
      const approved = (sessionId: string, agoMs: number) => entry({ kind: "needResolved", sessionId, outcome: "approved" }, agoMs);
      const sections = groupFeed([approved("a", 0), approved("b", 10_000), approved("c", 70_000), done("d", 20 * 60_000), done("e", 30 * 60_000)], NOW, {});
      expect(shape(sections)).toEqual([
        ["Just now", ["dikasih korek (approved)|a,b|2"]],
        ["1 min ago", ["dikasih korek (approved)|c|1"]],
        ["Earlier", ["turn done|d,e|2"]],
      ]);
      expect(sections[0]!.groups[0]!.line.joke).toBe("dikasih korek");
      expect(sections[0]!.groups[0]!.at).toBe(NOW);
    });

    test("the Needs you filter keeps the attention lines, and the sections they are in", () => {
      const sections = groupFeed(
        [done("a"), entry({ kind: "needStarted", sessionId: "a", need: "question" }), done("b", 5 * 60_000), done("c", 5 * 60_000)],
        NOW,
        {},
        true,
      );
      expect(shape(sections)).toEqual([["Just now", ["asked a question|a|1"]]]);
      expect(groupFeed([done("a")], NOW, {}, true)).toEqual([]);
    });

    test("a reminder reads from the session as it is now", () => {
      const sections = groupFeed([entry({ kind: "needReminder", sessionId: "a" })], NOW, { a: { need: { kind: "permission" } as PublicSession["need"] } });
      expect(sections[0]!.groups[0]!.line.joke).toBe("masih cari korek");
    });
  });
});
