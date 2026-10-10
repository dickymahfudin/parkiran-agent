import { describe, expect, test } from "bun:test";
import { IDLE_GRACE_S, createWake } from "./wake.ts";

function harness() {
  let now = 0;
  let sleeps = 0;
  const timers = new Map<number, { fn: () => void; at: number }>();
  let next = 1;
  const wake = createWake({
    now: () => now,
    setTimer: (fn, ms) => {
      const id = next++;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimer: (id) => void timers.delete(id as number),
    sleep: () => void sleeps++,
  });
  const advance = (ms: number) => {
    now += ms;
    for (const [id, t] of [...timers]) {
      if (t.at <= now) {
        timers.delete(id);
        t.fn();
      }
    }
  };
  return { wake, advance, sleeps: () => sleeps, pending: () => timers.size };
}

describe("audio wake", () => {
  test("a cue keeps the context awake for its length plus the grace, then it sleeps once", () => {
    const h = harness();
    h.wake.hold(1);
    h.advance((1 + IDLE_GRACE_S) * 1000 - 1);
    expect(h.sleeps()).toBe(0);
    h.advance(1);
    expect(h.sleeps()).toBe(1);
    expect(h.pending()).toBe(0);
  });

  test("cues in a row extend the wake instead of sleeping between them", () => {
    const h = harness();
    h.wake.hold(1);
    h.advance(1500);
    h.wake.hold(1);
    h.advance(2000);
    expect(h.sleeps()).toBe(0);
    h.advance(1000);
    expect(h.sleeps()).toBe(1);
    expect(h.pending()).toBe(0);
  });

  test("a shorter cue never shortens a longer wake; release sleeps at once", () => {
    const h = harness();
    h.wake.hold(5);
    h.wake.hold(0.1);
    h.advance(6000);
    expect(h.sleeps()).toBe(0);
    h.wake.release();
    expect(h.sleeps()).toBe(1);
    expect(h.pending()).toBe(0);
  });
});
