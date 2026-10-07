// The cinematic camera's director: picks what to show from the sessions and the recent events. Pure, unit tested.
import type { PublicSession } from "../../../shared/src/protocol.ts";
import type { Cue } from "../../../shared/src/session.ts";

/** close: face and hands; medium: the person and their seat; follow: wide enough to keep a walker in frame. */
export type Framing = "close" | "medium" | "follow";
export type ShotReason = "needs" | "failure" | "turnDone" | "friend" | "arrived" | "compact" | "tour";
export type Shot = { kind: "overview" } | { kind: "person"; sessionId: string; framing: Framing; why: ShotReason };

export interface DirectorState {
  shot: Shot;
  since: number;
  /** Events up to this sequence number have had their shot (or were too old for one). */
  seenSeq: number;
}

export interface CueAt {
  cue: Cue;
  at: number;
  seq: number;
}

/** No shot is cut short before this, so the camera never jumps around. */
export const MIN_HOLD_MS = 6000;
/** How long a shot stays once it has nothing new to show. */
const HOLD_MS: Record<ShotReason, number> = { needs: 12_000, failure: 6000, turnDone: 7000, friend: 9000, arrived: 14_000, compact: 18_000, tour: 9000 };
/** Higher wins: what needs the user first. */
const PRIORITY: Record<ShotReason, number> = { needs: 7, failure: 6, turnDone: 5, friend: 4, arrived: 3, compact: 2, tour: 1 };
/** An event older than this when the camera gets to it is skipped. */
const CUE_FRESH_MS = 8000;
/** Overview time between visits to someone at work. */
export const OVERVIEW_MS = 20_000;

const CUE_SHOT: Partial<Record<Cue["kind"], { why: ShotReason; framing: Framing }>> = {
  failure: { why: "failure", framing: "medium" },
  turnDone: { why: "turnDone", framing: "medium" },
  friendArrived: { why: "friend", framing: "medium" },
  arrived: { why: "arrived", framing: "follow" },
  compactStarted: { why: "compact", framing: "follow" },
};

export const START: DirectorState = { shot: { kind: "overview" }, since: 0, seenSeq: 0 };

const priority = (shot: Shot): number => (shot.kind === "person" ? PRIORITY[shot.why] : 0);

/** Is the shot still worth holding: its person is there, and a need or a coffee break it shows is still going on. */
function stillValid(shot: Shot, sessions: Readonly<Record<string, PublicSession>>, visible: (id: string) => boolean): boolean {
  if (shot.kind === "overview") return true;
  const s = sessions[shot.sessionId];
  if (!s || s.phase === "leaving" || !visible(s.id)) return false;
  if (shot.why === "needs") return s.need !== null;
  if (shot.why === "compact") return s.phase === "compacting";
  return true;
}

/**
 * The next shot. `cues` is newest first (the store's cue log); `visible` says whether a session's character is in the
 * lot. A shot holds at least `MIN_HOLD_MS`, then gives way to anything more important; a session that needs the user
 * always wins and is held until the need is handled. With nothing going on the camera rests on the overview and now
 * and then visits someone at work.
 */
export function direct(
  prev: DirectorState,
  sessions: Readonly<Record<string, PublicSession>>,
  cues: readonly CueAt[],
  now: number,
  visible: (id: string) => boolean,
): DirectorState {
  const held = now - prev.since;
  const valid = stillValid(prev.shot, sessions, visible);
  let seenSeq = prev.seenSeq;

  let want: Shot | null = null;
  const waiting = Object.values(sessions)
    .filter((s) => s.need && s.phase !== "leaving" && visible(s.id))
    .sort((a, b) => a.need!.since - b.need!.since || a.id.localeCompare(b.id));
  if (waiting[0]) want = { kind: "person", sessionId: waiting[0].id, framing: "close", why: "needs" };
  for (const c of cues) {
    if (c.seq <= prev.seenSeq) break;
    seenSeq = Math.max(seenSeq, c.seq);
    const shot = CUE_SHOT[c.cue.kind];
    const s = sessions[c.cue.sessionId];
    if (!shot || !s || now - c.at > CUE_FRESH_MS || !visible(s.id)) continue;
    const candidate: Shot = { kind: "person", sessionId: s.id, ...shot };
    if (!want || priority(candidate) > priority(want)) want = candidate;
  }
  // Events that came in while a shot could not be cut stay unseen, so they get their turn once it may be.
  if (valid && held < MIN_HOLD_MS) return { ...prev, seenSeq: prev.seenSeq };

  const same = (a: Shot, b: Shot) => a.kind === b.kind && (a.kind === "overview" || (b.kind === "person" && a.sessionId === b.sessionId && a.why === b.why));
  if (want && (!valid || priority(want) > priority(prev.shot) || (prev.shot.kind === "person" && held >= HOLD_MS[prev.shot.why] && !same(want, prev.shot)))) {
    return { shot: want, since: now, seenSeq };
  }
  if (valid && prev.shot.kind === "person" && (prev.shot.why === "needs" || held < HOLD_MS[prev.shot.why])) return { ...prev, seenSeq };
  if (valid && prev.shot.kind === "overview" && held < OVERVIEW_MS) return { ...prev, seenSeq };
  if (prev.shot.kind === "overview") {
    // A visit: someone at work, taking turns by the clock.
    const working = Object.values(sessions)
      .filter((s) => s.phase === "working" && !s.need && visible(s.id))
      .sort((a, b) => a.id.localeCompare(b.id));
    const pick = working[Math.floor(now / OVERVIEW_MS) % Math.max(1, working.length)];
    if (pick) return { shot: { kind: "person", sessionId: pick.id, framing: "medium", why: "tour" }, since: now, seenSeq };
    return { ...prev, seenSeq };
  }
  return { shot: { kind: "overview" }, since: now, seenSeq };
}
