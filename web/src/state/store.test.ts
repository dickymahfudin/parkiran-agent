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

describe("store after a reconnect", () => {
  test("hello drops a selection and acknowledgements of sessions that are gone", () => {
    const st = useApp.getState();
    st.apply(hello([session("keep"), session("gone")]));
    useApp.setState({ acknowledged: { keep: 1, gone: 2 } });
    useApp.getState().select("gone");
    expect(useApp.getState().selectedId).toBe("gone");
    useApp.getState().apply(hello([session("keep")]));
    expect(useApp.getState().selectedId).toBeNull();
    expect(useApp.getState().acknowledged).toEqual({ keep: 1 });
  });

  test("a session removed by a delta takes its acknowledgement with it", () => {
    useApp.getState().apply(hello([session("p"), session("q")]));
    useApp.setState({ acknowledged: { p: 1, q: 2 } });
    useApp.getState().apply({ type: "sessions", serverTime: Date.now(), updated: [], removed: ["q"] });
    expect(useApp.getState().acknowledged).toEqual({ p: 1 });
  });

  test("a late frame does not pull the clock back; a hello resets it", () => {
    const near = (a: number, b: number) => Math.abs(a - b) < 50;
    useApp.getState().apply({ ...hello([]), serverTime: Date.now() + 5000 });
    expect(near(useApp.getState().clockOffset, 5000)).toBe(true);
    useApp.getState().apply({ type: "cues", serverTime: Date.now() + 4700, cues: [] });
    expect(near(useApp.getState().clockOffset, 5000)).toBe(true);
    useApp.getState().apply({ ...hello([]), serverTime: Date.now() + 1000 });
    expect(near(useApp.getState().clockOffset, 1000)).toBe(true);
  });
});

describe("the inspector's tab", () => {
  test("selecting a session opens the Session tab; clearing it or resetting the view goes back to Events", () => {
    const st = useApp.getState();
    st.apply(hello([session("a"), session("b")]));
    st.setInspectorTab("events");
    useApp.getState().select("a");
    expect(useApp.getState().inspectorTab).toBe("session");
    useApp.getState().setInspectorTab("events");
    useApp.getState().select("b");
    expect(useApp.getState().inspectorTab).toBe("session");
    useApp.getState().select(null);
    expect(useApp.getState().inspectorTab).toBe("events");
    useApp.getState().select("a");
    useApp.getState().resetView();
    expect([useApp.getState().selectedId, useApp.getState().inspectorTab]).toEqual([null, "events"]);
  });

  test("the user can still pick a tab by hand", () => {
    useApp.getState().select(null);
    useApp.getState().setInspectorTab("session");
    expect(useApp.getState().inspectorTab).toBe("session");
  });

  test("the selected session ending, or missing after a reconnect, takes the inspector back to Events", () => {
    useApp.getState().apply(hello([session("a"), session("b")]));
    useApp.getState().select("a");
    useApp.getState().apply({ type: "sessions", serverTime: Date.now(), updated: [], removed: ["b"] });
    expect(useApp.getState().inspectorTab).toBe("session");
    useApp.getState().apply({ type: "sessions", serverTime: Date.now(), updated: [], removed: ["a"] });
    expect([useApp.getState().selectedId, useApp.getState().inspectorTab]).toEqual([null, "events"]);

    useApp.getState().apply(hello([session("a"), session("b")]));
    useApp.getState().select("b");
    useApp.getState().apply(hello([session("a")]));
    expect([useApp.getState().selectedId, useApp.getState().inspectorTab]).toEqual([null, "events"]);
  });

  test("a Session tab picked with nothing selected stays through updates", () => {
    useApp.getState().apply(hello([session("a")]));
    useApp.getState().select(null);
    useApp.getState().setInspectorTab("session");
    useApp.getState().apply({ type: "sessions", serverTime: Date.now(), updated: [], removed: ["a"] });
    expect(useApp.getState().inspectorTab).toBe("session");
  });
});
