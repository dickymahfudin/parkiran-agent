import { describe, expect, test } from "bun:test";
import type { HookEventName, IngestEvent } from "../src/events.ts";
import { reduce, tick } from "../src/reducer.ts";
import { DEFAULT_REDUCER_CONFIG, EMPTY_WORLD, type Cue, type World } from "../src/session.ts";

const S = "11111111-1111-1111-1111-111111111111";
const cfg = DEFAULT_REDUCER_CONFIG;

function ev(event: HookEventName, ts: number, extra: Partial<IngestEvent> = {}): IngestEvent {
  return { v: 1, event, sessionId: S, ts, project: "warung", branch: "main", ...extra };
}

function run(events: IngestEvent[], world: World = EMPTY_WORLD): { world: World; cues: Cue[] } {
  const cues: Cue[] = [];
  for (const e of events) {
    const r = reduce(world, e, cfg);
    world = r.world;
    cues.push(...r.cues);
  }
  return { world, cues };
}

const kinds = (cues: Cue[]): string[] => cues.map((c) => ("outcome" in c ? `${c.kind}:${c.outcome}` : c.kind));
const session = (w: World, id = S) => w.sessions[id]!;

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

describe("session lifecycle", () => {
  test("any event creates an unknown session (server restart) and seats it", () => {
    const { world, cues } = run([ev("PreToolUse", 10, { toolName: "Read", toolUseId: "t1" })]);
    expect(session(world)).toMatchObject({ seat: "bench-1a", phase: "working", work: "read", project: "warung" });
    expect(kinds(cues)).toEqual(["arrived"]);
  });

  test("SessionEnd for an unknown session is ignored", () => {
    expect(run([ev("SessionEnd", 1, { endReason: "other" })]).world).toEqual(EMPTY_WORLD);
  });

  test("start → prompt → tools by kind → stop", () => {
    const { world } = run([
      ev("SessionStart", 1, { source: "startup" }),
      ev("UserPromptSubmit", 2),
    ]);
    expect(session(world)).toMatchObject({ phase: "working", work: "think" });
    const kindsSeen: string[] = [];
    let w = world;
    for (const [i, tool] of ["Read", "Grep", "Bash", "Edit", "Write", "WebFetch", "Agent", "mcp__x__y"].entries()) {
      w = run([ev("PreToolUse", 10 + i * 2, { toolName: tool, toolUseId: `t${i}` })], w).world;
      kindsSeen.push(session(w).work);
      w = run([ev("PostToolUse", 11 + i * 2, { toolName: tool, toolUseId: `t${i}` })], w).world;
      expect(session(w).work).toBe("think");
    }
    expect(kindsSeen).toEqual(["read", "read", "bash", "edit", "edit", "web", "agent", "other"]);
    expect(session(w).toolCalls).toBe(8);
    const done = run([ev("Stop", 100)], w);
    expect(session(done.world).phase).toBe("idle");
    expect(kinds(done.cues)).toEqual(["turnDone"]);
  });

  test("SessionEnd → leaving, friends leave, removed after the exit walk, seat freed", () => {
    let { world, cues } = run([
      ev("SessionStart", 1),
      ev("SubagentStart", 2, { agentId: "a1", agentType: "Explore" }),
      ev("SessionEnd", 3, { endReason: "other" }),
    ]);
    expect(session(world).phase).toBe("leaving");
    expect(kinds(cues)).toEqual(["arrived", "friendArrived", "friendLeft", "leaving"]);
    expect(tick(world, 3 + cfg.leaveMs - 1, cfg).world).toBe(world);
    const removed = tick(world, 3 + cfg.leaveMs, cfg);
    expect(removed.world.sessions[S]).toBeUndefined();
    expect(kinds(removed.cues)).toEqual(["removed"]);
    const other = run([ev("SessionStart", 50_000, { sessionId: "22222222-2222-2222-2222-222222222222" })], removed.world);
    expect(other.world.sessions["22222222-2222-2222-2222-222222222222"]!.seat).toBe("bench-1a");
  });

  test("an event for a leaving session revives it (resume of the same id)", () => {
    const { world, cues } = run([ev("SessionStart", 1), ev("SessionEnd", 2), ev("SessionStart", 3, { source: "resume" })]);
    expect(session(world).phase).toBe("idle");
    expect(session(world).endedAt).toBeNull();
    expect(kinds(cues).filter((k) => k === "arrived")).toHaveLength(2);
  });

  test("project and branch follow the latest non-null values", () => {
    const { world } = run([ev("SessionStart", 1), ev("Stop", 2, { branch: "feature/korek" }), ev("Stop", 3, { branch: null })]);
    expect(session(world).branch).toBe("feature/korek");
  });

  test("reduce never mutates its input", () => {
    const base = deepFreeze(run([ev("SessionStart", 1), ev("PreToolUse", 2, { toolName: "Bash", toolUseId: "t1" })]).world);
    expect(() =>
      run([ev("PermissionRequest", 3, { toolName: "Bash" }), ev("PostToolUse", 4, { toolName: "Bash", toolUseId: "t1" }), ev("Stop", 5)], base),
    ).not.toThrow();
  });
});

describe("needs me: permission (korek)", () => {
  const ask = [
    ev("UserPromptSubmit", 1),
    ev("PreToolUse", 100, { toolName: "Bash", toolUseId: "t1" }),
    ev("PermissionRequest", 180, { toolName: "Bash" }),
  ];

  test("request pairs with the open PreToolUse and waits", () => {
    const { world, cues } = run(ask);
    expect(session(world).phase).toBe("waiting");
    expect(session(world).need).toMatchObject({ kind: "permission", toolName: "Bash", toolUseId: "t1" });
    expect(kinds(cues)).toContain("needStarted");
  });

  test("approved: PostToolUse of the paired id hands over the lighter", () => {
    const { world, cues } = run([...ask, ev("PostToolUse", 4000, { toolName: "Bash", toolUseId: "t1" })]);
    expect(session(world)).toMatchObject({ phase: "working", need: null, lastOutcome: { kind: "approved" } });
    expect(kinds(cues)).toContain("needResolved:approved");
  });

  test("approved then the tool fails: approval plus frustration", () => {
    const { cues } = run([...ask, ev("PostToolUseFailure", 4000, { toolName: "Bash", toolUseId: "t1", isInterrupt: false })]);
    expect(kinds(cues).slice(-2)).toEqual(["needResolved:approved", "failure"]);
  });

  test.each([
    ["UserPromptSubmit (you typed instead)", ev("UserPromptSubmit", 5000), "working"],
    ["Stop (denied with feedback, turn ended)", ev("Stop", 5000), "idle"],
    ["idle_prompt", ev("Notification", 5000, { notificationType: "idle_prompt" }), "idle"],
    ["internal SubagentStop after interrupt (measured)", ev("SubagentStop", 5000, { agentId: "a58a1923668a293d3", agentType: "" }), "working"],
    ["a new tool ≥ 500 ms later while the asked one never ran", ev("PreToolUse", 5000, { toolName: "Read", toolUseId: "t2" }), "working"],
  ])("manual deny inferred from %s", (_label, next, phase) => {
    const { world, cues } = run([...ask, next]);
    expect(session(world).need).toBeNull();
    expect(session(world).phase as string).toBe(phase);
    expect(session(world).lastOutcome?.kind).toBe("denied");
    expect(kinds(cues)).toContain("needResolved:denied");
  });

  test("a parallel tool starting right after the request does not count as a denial", () => {
    const { world } = run([...ask, ev("PreToolUse", 300, { toolName: "Read", toolUseId: "t2" })]);
    expect(session(world).phase).toBe("waiting");
    expect(session(world).need?.toolUseId).toBe("t1");
  });

  test("auto mode PermissionDenied", () => {
    const { world, cues } = run([...ask, ev("PermissionDenied", 900, { toolName: "Bash", toolUseId: "t1" })]);
    expect(session(world).need).toBeNull();
    expect(kinds(cues)).toContain("needResolved:denied");
    const noNeed = run([ev("PreToolUse", 1, { toolName: "Bash", toolUseId: "x" }), ev("PermissionDenied", 2, { toolName: "Bash", toolUseId: "x" })]);
    expect(kinds(noNeed.cues)).toContain("needResolved:denied");
  });

  test("permission_prompt: creates the need if the request was missed, reminds once otherwise", () => {
    const missed = run([ev("PreToolUse", 1, { toolName: "Bash", toolUseId: "t1" }), ev("Notification", 6000, { notificationType: "permission_prompt" })]);
    expect(session(missed.world).need?.kind).toBe("permission");
    const reminded = run([...ask, ev("Notification", 6200, { notificationType: "permission_prompt" }), ev("Notification", 9000, { notificationType: "permission_prompt" })]);
    expect(kinds(reminded.cues).filter((k) => k === "needReminder")).toHaveLength(1);
  });

  test("subagent permission pairs with the subagent's tool and resolves by id", () => {
    const { world, cues } = run([
      ev("PreToolUse", 1, { toolName: "Agent", toolUseId: "ag" }),
      ev("SubagentStart", 2, { agentId: "a1", agentType: "Explore" }),
      ev("PreToolUse", 3, { toolName: "Bash", toolUseId: "sb", agentId: "a1", agentType: "Explore" }),
      ev("PermissionRequest", 4, { toolName: "Bash", agentId: "a1", agentType: "Explore" }),
      ev("PostToolUse", 3000, { toolName: "Bash", toolUseId: "sb", agentId: "a1", agentType: "Explore" }),
    ]);
    expect(kinds(cues)).toContain("needResolved:approved");
    expect(session(world).phase).toBe("working");
  });
});

describe("needs me: questions and input", () => {
  test("AskUserQuestion waits until answered; its permission request is not a second need", () => {
    const { world, cues } = run([
      ev("PreToolUse", 1, { toolName: "AskUserQuestion", toolUseId: "q1" }),
      ev("PermissionRequest", 2, { toolName: "AskUserQuestion" }),
    ]);
    expect(session(world).need).toMatchObject({ kind: "question", toolUseId: "q1" });
    expect(kinds(cues).filter((k) => k === "needStarted")).toHaveLength(1);
    const answered = run([ev("PostToolUse", 9000, { toolName: "AskUserQuestion", toolUseId: "q1" })], world);
    expect(kinds(answered.cues)).toEqual(["needResolved:answered"]);
  });

  test("MCP elicitation", () => {
    const { world } = run([ev("Elicitation", 1)]);
    expect(session(world).need?.kind).toBe("input");
    expect(kinds(run([ev("ElicitationResult", 2)], world).cues)).toEqual(["needResolved:answered"]);
    expect(session(run([ev("Notification", 1, { notificationType: "elicitation_dialog" })]).world).need?.kind).toBe("input");
  });
});

describe("failures", () => {
  test("tool failure frustrates but keeps working; interrupts do not", () => {
    const { world, cues } = run([
      ev("PreToolUse", 1, { toolName: "Bash", toolUseId: "t1" }),
      ev("PostToolUseFailure", 2, { toolName: "Bash", toolUseId: "t1", isInterrupt: false }),
      ev("PreToolUse", 3, { toolName: "Bash", toolUseId: "t2" }),
      ev("PostToolUseFailure", 4, { toolName: "Bash", toolUseId: "t2", isInterrupt: true }),
    ]);
    expect(kinds(cues).filter((k) => k === "failure")).toHaveLength(1);
    expect(session(world)).toMatchObject({ phase: "working", failures: 2, toolCalls: 2 });
  });

  test("StopFailure (API error) ends the turn frustrated", () => {
    const { world, cues } = run([ev("UserPromptSubmit", 1), ev("StopFailure", 2, { stopError: "rate_limit" })]);
    expect(session(world)).toMatchObject({ phase: "idle", lastOutcome: { kind: "failure" } });
    expect(cues.at(-1)).toEqual({ kind: "failure", sessionId: S, source: "turn" });
  });
});

describe("compaction (kopi run)", () => {
  test("working → compacting → back to working", () => {
    const { world, cues } = run([
      ev("PreToolUse", 1, { toolName: "Read", toolUseId: "t1" }),
      ev("PreCompact", 2, { compactTrigger: "auto" }),
      ev("Stop", 3),
    ]);
    expect(session(world)).toMatchObject({ phase: "compacting", resumePhase: "working" });
    const after = run([ev("PostCompact", 4, { compactTrigger: "auto" })], world);
    expect(session(after.world).phase).toBe("working");
    expect(kinds([...cues, ...after.cues])).toContain("compactDone");
    expect(session(after.world).compactions).toBe(1);
  });

  test("idle → compacting → idle", () => {
    const { world } = run([ev("SessionStart", 1), ev("PreCompact", 2, { compactTrigger: "manual" }), ev("PostCompact", 3)]);
    expect(session(world).phase).toBe("idle");
  });
});

describe("subagents (friends)", () => {
  test("friend sits next to the parent, mirrors its own tools, leaves on stop", () => {
    let { world, cues } = run([
      ev("PreToolUse", 1, { toolName: "Agent", toolUseId: "ag" }),
      ev("SubagentStart", 2, { agentId: "a1", agentType: "Explore" }),
      ev("PreToolUse", 3, { toolName: "Grep", toolUseId: "s1", agentId: "a1", agentType: "Explore" }),
    ]);
    expect(session(world).subagents.a1).toMatchObject({ seat: "bench-1b", work: "read", lastTool: "Grep", type: "Explore" });
    expect(session(world).work).toBe("agent");
    ({ world } = run([ev("SubagentStop", 4, { agentId: "a1", agentType: "Explore" })], world));
    expect(session(world).subagents).toEqual({});
    expect(kinds(cues)).toContain("friendArrived");
  });

  test("unknown SubagentStop with a type is ignored; no friend appears", () => {
    const { world, cues } = run([ev("SessionStart", 1), ev("SubagentStop", 2, { agentId: "zz", agentType: "Plan" })]);
    expect(session(world).subagents).toEqual({});
    expect(kinds(cues)).toEqual(["arrived"]);
  });

  test("with the neighbour seat taken, a friend sits on any free seat instead of standing", () => {
    let world = EMPTY_WORLD;
    for (let i = 0; i < 3; i++) world = run([ev("SessionStart", i, { sessionId: `0000000${i}-0000-0000-0000-000000000000` })], world).world;
    world = run([ev("SubagentStart", 9, { sessionId: "00000000-0000-0000-0000-000000000000", agentId: "f", agentType: "Explore" })], world).world;
    expect(world.sessions["00000000-0000-0000-0000-000000000000"]!.seat).toBe("bench-1a");
    expect(world.sessions["00000000-0000-0000-0000-000000000000"]!.subagents.f!.seat).toBe("bench-2b");
  });

  test("five friends of one session never share a seat; the ones that find none stand", () => {
    let world = EMPTY_WORLD;
    for (let i = 0; i < 6; i++) world = run([ev("SessionStart", i, { sessionId: `0000000${i}-0000-0000-0000-000000000000` })], world).world;
    const parent = "00000000-0000-0000-0000-000000000000";
    for (const a of ["f1", "f2", "f3", "f4", "f5"]) world = run([ev("SubagentStart", 10, { sessionId: parent, agentId: a, agentType: "general-purpose" })], world).world;
    const seats = Object.values(world.sessions[parent]!.subagents).map((f) => f.seat);
    expect(seats).toEqual(["stool-2", "stool-4", "hood-1", "hood-2", null]);
    const all = [...Object.values(world.sessions).map((s) => s.seat), ...seats].filter((x) => x !== null);
    expect(new Set(all).size).toBe(all.length);
  });

  test("a friend left standing sits down when a seat frees up", () => {
    let world = EMPTY_WORLD;
    const ids = Array.from({ length: 10 }, (_, i) => `${String(i).padStart(8, "0")}-0000-0000-0000-000000000000`);
    for (const [i, id] of ids.entries()) world = run([ev("SessionStart", i, { sessionId: id })], world).world;
    world = run([ev("SubagentStart", 20, { sessionId: ids[0]!, agentId: "f", agentType: "Explore" })], world).world;
    expect(world.sessions[ids[0]!]!.subagents.f!.seat).toBeNull();
    world = run([ev("SessionEnd", 21, { sessionId: ids[9]!, endReason: "other" })], world).world;
    world = tick(world, 21 + cfg.leaveMs, cfg).world;
    world = run([ev("PreToolUse", 30, { sessionId: ids[0]!, toolName: "Read", toolUseId: "r", agentId: "f", agentType: "Explore" })], world).world;
    expect(world.sessions[ids[0]!]!.subagents.f!.seat).toBe("hood-2");
  });
});

describe("ordering", () => {
  test("PostToolUse arriving before its PreToolUse: the late Pre is ignored", () => {
    const { world } = run([
      ev("UserPromptSubmit", 1),
      ev("PostToolUse", 105, { toolName: "Read", toolUseId: "t1" }),
      ev("PreToolUse", 100, { toolName: "Read", toolUseId: "t1" }),
    ]);
    expect(session(world)).toMatchObject({ phase: "working", work: "think", openTools: {} });
  });

  test("a late event counts but cannot move the phase backwards", () => {
    const { world } = run([
      ev("PreToolUse", 100, { toolName: "Read", toolUseId: "t1" }),
      ev("Stop", 300),
      ev("PostToolUse", 150, { toolName: "Read", toolUseId: "t1" }),
    ]);
    expect(session(world)).toMatchObject({ phase: "idle", toolCalls: 1 });
  });
});

describe("seats", () => {
  test("benches, then stools, then car hoods, then standing", () => {
    let world = EMPTY_WORLD;
    const ids = Array.from({ length: 11 }, (_, i) => `${String(i).padStart(8, "0")}-0000-0000-0000-000000000000`);
    for (const [i, id] of ids.entries()) world = run([ev("SessionStart", i, { sessionId: id })], world).world;
    expect(ids.map((id) => world.sessions[id]!.seat)).toEqual([
      "bench-1a", "bench-2a", "bench-1b", "bench-2b", "stool-1", "stool-3", "stool-2", "stool-4", "hood-1", "hood-2", null,
    ]);
  });
});

describe("standing until a seat frees up", () => {
  test("a session that arrived to a full lot sits down on its next event after someone leaves", () => {
    let world = EMPTY_WORLD;
    const ids = Array.from({ length: 11 }, (_, i) => `${String(i).padStart(8, "0")}-0000-0000-0000-000000000000`);
    for (const [i, id] of ids.entries()) world = run([ev("SessionStart", i, { sessionId: id })], world).world;
    expect(world.sessions[ids[10]!]!.seat).toBeNull();
    world = run([ev("SessionEnd", 20, { sessionId: ids[2]!, endReason: "other" })], world).world;
    world = run([ev("PreToolUse", 21, { sessionId: ids[10]!, toolName: "Read", toolUseId: "r" })], world).world;
    expect(world.sessions[ids[10]!]!.seat).toBeNull();
    world = tick(world, 20 + cfg.leaveMs, cfg).world;
    world = run([ev("PostToolUse", 22 + cfg.leaveMs, { sessionId: ids[10]!, toolName: "Read", toolUseId: "r" })], world).world;
    expect(world.sessions[ids[10]!]!.seat).toBe("bench-1b");
  });
});

describe("timers (tick)", () => {
  test("idle long enough → dozes; any event wakes", () => {
    const { world } = run([ev("SessionStart", 0), ev("Stop", 10)]);
    const dozed = tick(world, 10 + cfg.idleMs, cfg);
    expect(session(dozed.world).dozing).toBe(true);
    expect(kinds(dozed.cues)).toEqual(["dozeStarted"]);
    expect(tick(dozed.world, 20 + cfg.idleMs, cfg).cues).toEqual([]);
    const woke = run([ev("UserPromptSubmit", 11 + cfg.idleMs)], dozed.world);
    expect(session(woke.world).dozing).toBe(false);
    expect(kinds(woke.cues)).toEqual(["woke"]);
  });

  test("working sessions never doze (long tool runs)", () => {
    const { world } = run([ev("PreToolUse", 0, { toolName: "Bash", toolUseId: "t" })]);
    expect(session(tick(world, cfg.idleMs * 2, cfg).world).dozing).toBe(false);
  });

  test("no events for the reap window → walks away", () => {
    const { world } = run([ev("SessionStart", 0)]);
    const reaped = tick(world, cfg.reapMs, cfg);
    expect(session(reaped.world).phase).toBe("leaving");
    expect(kinds(reaped.cues)).toContain("leaving");
  });

  test("stale friends leave", () => {
    const { world } = run([ev("SessionStart", 0), ev("SubagentStart", 1, { agentId: "a1", agentType: "Explore" }), ev("PreToolUse", cfg.subagentStaleMs, { toolName: "Bash", toolUseId: "t" })]);
    const r = tick(world, 1 + cfg.subagentStaleMs, cfg);
    expect(session(r.world).subagents).toEqual({});
    expect(kinds(r.cues)).toEqual(["friendLeft"]);
  });

  test("tick returns the same object when nothing changes", () => {
    const { world } = run([ev("PreToolUse", 0, { toolName: "Bash", toolUseId: "t" })]);
    expect(tick(world, 1000, cfg).world).toBe(world);
  });
});

describe("insights (timeline, tool mix, waiting, milestones)", () => {
  const M = 60_000;
  const tool = (name: string, at: number, id: string): IngestEvent[] => [ev("PreToolUse", at, { toolName: name, toolUseId: id }), ev("PostToolUse", at + 1, { toolName: name, toolUseId: id })];

  test("the timeline records state changes only, thinking and tool calls both count as work", () => {
    const { world } = run([
      ev("SessionStart", 0),
      ev("UserPromptSubmit", 1 * M),
      ...tool("Read", 2 * M, "t1"),
      ...tool("Bash", 3 * M, "t2"),
      ev("Stop", 10 * M),
    ]);
    expect(session(world).timeline).toEqual([
      { state: "idle", at: 0 },
      { state: "working", at: 1 * M },
      { state: "idle", at: 10 * M },
    ]);
    expect(session(world).workedMs).toBe(9 * M);
  });

  test("tool mix by group (MCP on its own), asks and the time spent waiting for the user", () => {
    const { world } = run([
      ev("UserPromptSubmit", 0),
      ...tool("Read", 1000, "t1"),
      ...tool("mcp__Claude_Browser__navigate", 2000, "t2"),
      ev("PreToolUse", 3000, { toolName: "Bash", toolUseId: "t3" }),
      ev("PermissionRequest", 3100, { toolName: "Bash" }),
      ev("PostToolUse", 63_100, { toolName: "Bash", toolUseId: "t3" }),
    ]);
    const s = session(world);
    expect(s.toolMix).toEqual({ read: 1, mcp: 1, bash: 1 });
    expect(s.asks).toBe(1);
    expect(s.waitedMs).toBe(60_000);
    expect(s.timeline.map((e) => e.state)).toEqual(["working", "waiting", "working"]);
  });

  test("the timeline keeps about the last hour", () => {
    const events: IngestEvent[] = [];
    for (let i = 0; i < 40; i++) events.push(ev("UserPromptSubmit", i * 5 * M), ev("Stop", i * 5 * M + M));
    const t = session(run(events).world).timeline;
    expect(t[1]!.at).toBeGreaterThan(39 * 5 * M + M - 60 * M);
    expect(t[0]!.at).toBeLessThanOrEqual(39 * 5 * M + M - 60 * M);
  });

  test("milestones are announced once: tool calls, compactions, and hours of work (with time, from tick)", () => {
    const events: IngestEvent[] = [ev("UserPromptSubmit", 0)];
    for (let i = 0; i < 101; i++) events.push(...tool("Read", 10 + i * 10, `c${i}`));
    events.push(ev("PreCompact", 5000), ev("PostCompact", 6000), ev("PreCompact", 7000), ev("PostCompact", 8000));
    const { world, cues } = run(events);
    const milestones = cues.filter((c) => c.kind === "milestone");
    expect(milestones).toEqual([
      { kind: "milestone", sessionId: S, milestone: "calls", value: 100 },
      { kind: "milestone", sessionId: S, milestone: "compactions", value: 2 },
    ]);
    // The two kopi runs (2 s) are not work.
    expect(tick(world, 60 * M, cfg).cues).toEqual([]);
    const hour = tick(world, 60 * M + 2000, cfg);
    expect(hour.cues).toEqual([{ kind: "milestone", sessionId: S, milestone: "work", value: 1 }]);
    expect(tick(hour.world, 60 * M + 5000, cfg).cues).toEqual([]);
  });
});
