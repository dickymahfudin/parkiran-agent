import { describe, expect, test } from "bun:test";
import type { PublicSession, ServerMessage } from "../../../shared/src/protocol.ts";
import { parseServerMessage } from "../net/connection.ts";
import { useApp } from "./store.ts";

function session(id: string, project = "warung-app"): PublicSession {
  return {
    id,
    project,
    branch: "main",
    seat: "bench-1a",
    phase: "working",
    work: "bash",
    currentTool: "Bash",
    lastTool: null,
    need: null,
    lastOutcome: null,
    resumePhase: null,
    dozing: false,
    toolCalls: 0,
    failures: 0,
    compactions: 0,
    toolMix: {},
    asks: 0,
    waitedMs: 0,
    timeline: [],
    workedMs: 0,
    milestones: [],
    startedAt: 1000,
    lastEventAt: 1000,
    lastEvent: "PreToolUse",
    endedAt: null,
    subagents: {},
  };
}

const hello = (sessions: PublicSession[]): ServerMessage => ({
  type: "hello",
  serverTime: 5000,
  config: { lat: -6.2, lon: 106.8, idleMinutes: 30 },
  sessions,
  usage: { available: false, reason: "n/a" },
});

describe("store.apply", () => {
  test("hello replaces the sessions, deltas update and remove them", () => {
    const { apply } = useApp.getState();
    apply(hello([session("a"), session("b")]));
    expect(Object.keys(useApp.getState().sessions).sort()).toEqual(["a", "b"]);
    apply({ type: "sessions", serverTime: 6000, updated: [session("c")], removed: ["a"] });
    expect(Object.keys(useApp.getState().sessions).sort()).toEqual(["b", "c"]);
  });

  test("cues are kept newest first, at most 40", () => {
    const { apply } = useApp.getState();
    for (let i = 0; i < 50; i++) apply({ type: "cues", serverTime: 7000 + i, cues: [{ kind: "turnDone", sessionId: "b" }] });
    const log = useApp.getState().cueLog;
    expect(log.length).toBe(40);
    expect(log[0]!.at).toBeGreaterThan(log[39]!.at);
  });

  test("a message type this build does not know leaves the state intact", () => {
    const before = useApp.getState();
    const { apply } = before;
    apply({ type: "recap", serverTime: 9000 } as unknown as ServerMessage);
    const after = useApp.getState();
    expect(after.sessions).toBe(before.sessions);
    expect(after.cueLog).toBe(before.cueLog);
    expect(typeof after.apply).toBe("function");
    expect(after.clockOffset).toBeNumber();
  });
});

describe("parseServerMessage", () => {
  test("accepts the known frames", () => {
    expect(parseServerMessage({ type: "cues", serverTime: 1, cues: [] })).toMatchObject({ type: "cues" });
  });

  test("rejects unknown types and malformed frames before they reach the store", () => {
    expect(() => parseServerMessage({ type: "recap", serverTime: 1 })).toThrow(/unknown message type "recap"/);
    expect(() => parseServerMessage({ type: "cues" })).toThrow(/serverTime/);
    expect(() => parseServerMessage(null)).toThrow(/not an object/);
    expect(() => parseServerMessage([1])).toThrow(/not an object/);
    expect(() => parseServerMessage("hello")).toThrow(/not an object/);
  });
});
