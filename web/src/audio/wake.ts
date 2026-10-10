// Keeps the audio context awake only while a cue plays. Pure (timers injected), unit tested.

/** After the last cue ends, the context sleeps this long later (a burst of cues does not wake and sleep each time). */
export const IDLE_GRACE_S = 2;

export interface WakeDeps {
  /** ms */
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  sleep(): void;
}

export function createWake(deps: WakeDeps) {
  let until = 0;
  let timer: unknown = null;
  const arm = (): void => {
    if (timer !== null) deps.clearTimer(timer);
    timer = deps.setTimer(
      () => {
        timer = null;
        deps.sleep();
      },
      Math.max(0, until - deps.now()),
    );
  };
  return {
    /** Stay awake at least `seconds` from now (plus the grace). */
    hold(seconds: number): void {
      until = Math.max(until, deps.now() + (seconds + IDLE_GRACE_S) * 1000);
      arm();
    },
    /** Sleep now (sound turned off). */
    release(): void {
      until = 0;
      if (timer !== null) deps.clearTimer(timer);
      timer = null;
      deps.sleep();
    },
    get awakeUntil(): number {
      return until;
    },
  };
}
