// How often the scene renders, and when it renders light. Pure, unit tested; Scene.tsx's FrameLimiter applies it.
import type { PublicSession } from "../../../shared/src/protocol.ts";

/** You are moving the camera (drag, scroll, click, keys) or it is moving by itself (following someone, cinematic). */
export const ACTIVE_FPS = 60;
/** Sessions at work while you just watch: typing, smoke and passing cars read smoothly at half the rate. */
export const WATCH_FPS = 30;
/** Everyone idle or dozing, nothing selected, camera still: smoke and breathing still read fine at this rate. */
export const QUIET_FPS = 20;
/** Another window has the focus (the lot watched on a second screen). */
export const BACKGROUND_FPS = 15;
/** The camera (or your mouse and keys) must have rested this long before the lot counts as still. */
export const STILL_AFTER_MS = 2000;
/** A session that changed this recently may still be walking in, sitting down or reacting. */
export const SETTLE_MS = 20_000;
/** Unfocused this long: render light (resolution 1, no ambient occlusion). Shorter swaps would cause visible hitches. */
export const LITE_AFTER_MS = 3000;

export interface PaceInput {
  focused: boolean;
  quiet: boolean;
  cinematic: boolean;
  /** Since the camera last moved or you last clicked, scrolled or typed. */
  stillForMs: number;
}

/**
 * 60 only while the view moves: that is where a lower rate shows (a panning camera judders at 30). Watching sessions
 * work from a still camera is 30, a quiet lot 20, another window in front 15.
 */
export function targetFps(p: PaceInput): number {
  if (!p.focused) return BACKGROUND_FPS;
  if (p.stillForMs < STILL_AFTER_MS) return ACTIVE_FPS;
  if (p.quiet && !p.cinematic) return QUIET_FPS;
  return WATCH_FPS;
}

/** Shortest time between two frames at `fps`, with a few ms of vsync jitter allowed. */
export function minFrameSeconds(fps: number): number {
  return 1 / fps - 0.004;
}

type Quietness = Pick<PublicSession, "phase" | "need" | "subagents" | "lastEventAt">;

/**
 * Nothing on the lot that needs a smooth 60: every session idle (or dozing) without a need or a friend, none changed
 * in the last `SETTLE_MS` (an arrival walks in for ~15 s), and nobody selected (the camera would follow them).
 */
export function isQuietLot(sessions: readonly Quietness[], selectedId: string | null, now: number): boolean {
  if (selectedId !== null) return false;
  return sessions.every((s) => s.phase === "idle" && s.need === null && Object.keys(s.subagents).length === 0 && now - s.lastEventAt >= SETTLE_MS);
}

/** Render light once the window has been in the background for a while; at once back to full when it returns. */
export function isLite(focused: boolean, unfocusedForMs: number): boolean {
  return !focused && unfocusedForMs >= LITE_AFTER_MS;
}
