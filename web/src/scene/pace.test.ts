import { describe, expect, test } from "bun:test";
import type { PublicSession } from "../../../shared/src/protocol.ts";
import {
  ACTIVE_FPS,
  BACKGROUND_FPS,
  LITE_AFTER_MS,
  QUIET_FPS,
  SETTLE_MS,
  STILL_AFTER_MS,
  WATCH_FPS,
  isLite,
  isQuietLot,
  minFrameSeconds,
  targetFps,
} from "./pace.ts";

const s = (over: Partial<PublicSession>): PublicSession => ({ phase: "idle", need: null, subagents: {}, lastEventAt: 0, ...over }) as unknown as PublicSession;
const NOW = 1_000_000;

describe("frame pacing", () => {
  test("60 while the view moves, 30 watching sessions work, 20 on a quiet lot, 15 in the background", () => {
    const still = { focused: true, quiet: false, cinematic: false, stillForMs: STILL_AFTER_MS };
    expect(targetFps(still)).toBe(WATCH_FPS);
    expect(targetFps({ ...still, quiet: true })).toBe(QUIET_FPS);
    // Moving the camera, or it moving by itself, is always the full rate, busy lot or quiet.
    expect(targetFps({ ...still, stillForMs: STILL_AFTER_MS - 1 })).toBe(ACTIVE_FPS);
    expect(targetFps({ ...still, quiet: true, stillForMs: 0 })).toBe(ACTIVE_FPS);
    // Cinematic between moves never drops to the quiet rate.
    expect(targetFps({ ...still, quiet: true, cinematic: true })).toBe(WATCH_FPS);
    expect(targetFps({ ...still, focused: false, stillForMs: 0 })).toBe(BACKGROUND_FPS);
  });

  test("the frame budget leaves room for vsync jitter", () => {
    expect(minFrameSeconds(60)).toBeCloseTo(1 / 60 - 0.004, 6);
    expect(minFrameSeconds(15)).toBeGreaterThan(minFrameSeconds(20));
  });

  test("a lot is quiet only when everyone has settled into idle, nobody needs you and nobody is followed", () => {
    expect(isQuietLot([], null, NOW)).toBe(true);
    expect(isQuietLot([s({}), s({ phase: "idle" })], null, NOW)).toBe(true);
    expect(isQuietLot([s({ phase: "working" })], null, NOW)).toBe(false);
    expect(isQuietLot([s({ phase: "compacting" })], null, NOW)).toBe(false);
    expect(isQuietLot([s({ phase: "leaving" })], null, NOW)).toBe(false);
    expect(isQuietLot([s({ need: { kind: "permission" } as PublicSession["need"] })], null, NOW)).toBe(false);
    expect(isQuietLot([s({ subagents: { a: {} } as unknown as PublicSession["subagents"] })], null, NOW)).toBe(false);
    expect(isQuietLot([s({ lastEventAt: NOW - SETTLE_MS + 1 })], null, NOW)).toBe(false);
    expect(isQuietLot([s({})], "x", NOW)).toBe(false);
  });

  test("light rendering only after a while in the background", () => {
    expect(isLite(true, 60_000)).toBe(false);
    expect(isLite(false, LITE_AFTER_MS - 1)).toBe(false);
    expect(isLite(false, LITE_AFTER_MS)).toBe(true);
  });
});
