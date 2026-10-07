// Where the traces by a seat go and how many there are. Pure, unit tested; drawn by Traces.tsx.
import type { PublicSession } from "../../../../shared/src/protocol.ts";
import { BENCH_Y, SEAT_PLACES } from "../layout.ts";

/** One butt per this much time in the lot. */
export const BUTT_EVERY_MS = 15 * 60_000;
export const MAX_BUTTS = 12;
export const MAX_CUPS = 5;

export interface TraceSpot {
  /** Where the ashtray stands (world), and the direction the cups line up in. */
  at: [number, number, number];
  along: [number, number];
}

/** The spot next to a seat: the free end of the bench, the ground beside a stool or in front of a car's bumper. */
export function traceSpot(seatId: string): TraceSpot | null {
  const seat = SEAT_PLACES[seatId];
  if (!seat) return null;
  const [x, , z] = seat.hip;
  if (seat.style === "bench") {
    const outward = seatId.endsWith("a") ? -1 : 1;
    return { at: [x + outward * 0.33, BENCH_Y, z - 0.02], along: [outward, 0] };
  }
  if (seat.style === "stool") return { at: [x + 0.05, 0, z + 0.34], along: [0, 1] };
  return { at: [x + 0.62, 0, z + 0.38], along: [1, 0] };
}

/** How many butts and empty glasses a session has left by its seat. */
export function traceCounts(s: Pick<PublicSession, "startedAt" | "compactions">, now: number): { butts: number; cups: number } {
  return {
    butts: Math.min(MAX_BUTTS, Math.floor(Math.max(0, now - s.startedAt) / BUTT_EVERY_MS)),
    cups: Math.min(MAX_CUPS, s.compactions),
  };
}
