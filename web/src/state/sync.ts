// Pure rules for keeping the HUD in step with the server, unit tested.

/** A drop in the measured offset larger than this is a clock change (or a new server), not network jitter. */
export const CLOCK_JUMP_MS = 2000;

/**
 * Server clock minus local clock, from one frame. Each sample is the true offset minus that frame's delivery delay, so
 * the largest sample is the best estimate: later frames may only raise it. A `hello` (a new connection) starts over,
 * and a drop of more than `CLOCK_JUMP_MS` is taken as the clock having moved.
 */
export function nextClockOffset(previous: number, sample: number, fresh: boolean): number {
  if (fresh || sample > previous || previous - sample > CLOCK_JUMP_MS) return sample;
  return previous;
}

/** Acknowledged needs, kept only for sessions that are still in the lot. */
export function pruneAcknowledged(acknowledged: Readonly<Record<string, number>>, sessions: Readonly<Record<string, unknown>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, since] of Object.entries(acknowledged)) if (sessions[id]) out[id] = since;
  return out;
}

/** The selection, if the selected session is still in the lot. */
export function keepSelection(selectedId: string | null, sessions: Readonly<Record<string, unknown>>): string | null {
  return selectedId !== null && sessions[selectedId] ? selectedId : null;
}
