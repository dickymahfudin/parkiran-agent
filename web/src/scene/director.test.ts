import { describe, expect, test } from "bun:test";
import type { PublicSession } from "../../../shared/src/protocol.ts";
import type { Cue } from "../../../shared/src/session.ts";
import { MIN_HOLD_MS, OVERVIEW_MS, START, direct, type CueAt, type DirectorState } from "./director.ts";

const session = (id: string, over: Partial<PublicSession> = {}): PublicSession =>
  ({ id, phase: "working", work: "edit", need: null, subagents: {}, ...over }) as unknown as PublicSession;
const all = (_id: string) => true;
const label = (st: DirectorState) => (st.shot.kind === "overview" ? "overview" : `${st.shot.why}:${st.shot.sessionId}`);

/** Runs the director once a second (like the camera does every frame) and records each cut. */
function run(state: DirectorState, from: number, to: number, sessions: () => Record<string, PublicSession>, cues: () => CueAt[], visible = all) {
  const cuts: { at: number; shot: string }[] = [];
  let s = state;
  for (let t = from; t <= to; t += 1000) {
    const next = direct(s, sessions(), cues(), t, visible);
    if (label(next) !== label(s)) cuts.push({ at: t, shot: label(next) });
    s = next;
  }
  return { cuts, state: s };
}

let seq = 0;
const cue = (c: Cue, at: number): CueAt => ({ cue: c, at, seq: ++seq });

describe("director", () => {
  test("a session that needs you gets a close-up, held until the need is handled", () => {
    let need: PublicSession["need"] = { kind: "permission", since: 500 } as PublicSession["need"];
    const sessions = () => ({ a: session("a", { need }), b: session("b") });
    let { cuts, state } = run({ ...START, since: -OVERVIEW_MS }, 0, 30_000, sessions, () => []);
    expect(cuts[0]).toEqual({ at: 0, shot: "needs:a" });
    expect(cuts).toHaveLength(1);
    expect(state.shot).toMatchObject({ framing: "close" });
    need = null;
    ({ cuts } = run(state, 31_000, 32_000, sessions, () => []));
    expect(cuts[0]?.shot).not.toBe("needs:a");
  });

  test("an event gets its shot, then the camera goes back to the overview", () => {
    const sessions = () => ({ a: session("a", { phase: "idle" }) });
    const log = [cue({ kind: "turnDone", sessionId: "a" }, 1000)];
    const { cuts } = run({ ...START, since: 0 }, 1000, 30_000, sessions, () => log);
    expect(cuts.map((c) => c.shot)).toEqual(["turnDone:a", "overview"]);
    expect(cuts[1]!.at - cuts[0]!.at).toBeGreaterThanOrEqual(MIN_HOLD_MS);
  });

  test("never cuts more often than every 6 s; more important events take over after that", () => {
    // Idle, so no visit to someone at work gets in between.
    const sessions = () => ({ a: session("a", { phase: "idle" }), b: session("b", { phase: "idle" }), c: session("c", { phase: "idle" }) });
    const log: CueAt[] = [];
    let t = 0;
    const cues = () => {
      if (t === 1000) log.unshift(cue({ kind: "arrived", sessionId: "a" }, t));
      if (t === 2000) log.unshift(cue({ kind: "turnDone", sessionId: "b" }, t));
      if (t === 3000) log.unshift(cue({ kind: "failure", sessionId: "c", source: "tool" }, t));
      return log;
    };
    const cuts: number[] = [];
    let s: DirectorState = { ...START, since: -60_000 };
    for (t = 0; t <= 20_000; t += 500) {
      const next = direct(s, sessions(), cues(), t, all);
      if (label(next) !== label(s)) cuts.push(t);
      s = next;
    }
    expect(cuts.slice(0, 2)).toEqual([1000, 1000 + MIN_HOLD_MS]);
    for (let i = 1; i < cuts.length; i++) expect(cuts[i]! - cuts[i - 1]!).toBeGreaterThanOrEqual(MIN_HOLD_MS);
    expect(s.shot.kind === "overview" || s.shot.why === "tour").toBe(true);
    // The failure (most important) took over once the arrival had been held long enough; every event was considered.
    expect(s.seenSeq).toBe(seq);
  });

  test("with nothing going on it rests on the overview and now and then visits someone at work", () => {
    const sessions = () => ({ a: session("a"), z: session("z", { phase: "idle" }) });
    const { cuts } = run({ ...START, since: 0 }, 0, 60_000, sessions, () => []);
    expect(cuts[0]).toEqual({ at: OVERVIEW_MS, shot: "tour:a" });
    expect(cuts[1]?.shot).toBe("overview");
  });

  test("people not (yet) in the lot are not filmed", () => {
    const need = { kind: "question", since: 0 } as PublicSession["need"];
    const sessions = () => ({ a: session("a", { need }) });
    const { cuts } = run({ ...START, since: 0 }, 0, 10_000, sessions, () => [], (id) => id !== "a");
    expect(cuts).toHaveLength(0);
  });
});
