export type SeatKind = "bench" | "stool" | "hood";

export interface SeatDef {
  id: string;
  kind: SeatKind;
  /** Seats a subagent friend may take when this seat's owner spawns one. */
  neighbours: readonly string[];
}

// Allocation order follows the brief: benches, then warung stools, then car hoods.
// World positions live in the web scene; the server only needs identities and adjacency.
export const SEATS: readonly SeatDef[] = [
  { id: "bench-1a", kind: "bench", neighbours: ["bench-1b"] },
  { id: "bench-2a", kind: "bench", neighbours: ["bench-2b"] },
  { id: "bench-1b", kind: "bench", neighbours: ["bench-1a"] },
  { id: "bench-2b", kind: "bench", neighbours: ["bench-2a"] },
  { id: "stool-1", kind: "stool", neighbours: ["stool-2"] },
  { id: "stool-3", kind: "stool", neighbours: ["stool-4", "stool-2"] },
  { id: "stool-2", kind: "stool", neighbours: ["stool-1", "stool-3"] },
  { id: "stool-4", kind: "stool", neighbours: ["stool-3"] },
  { id: "hood-1", kind: "hood", neighbours: ["hood-2"] },
  { id: "hood-2", kind: "hood", neighbours: ["hood-1"] },
];

const SEAT_IDS: ReadonlySet<string> = new Set(SEATS.map((s) => s.id));

export function isSeatId(value: unknown): value is string {
  return typeof value === "string" && SEAT_IDS.has(value);
}

/** First free seat in allocation order, or null when the lot is full (the character stands). */
export function pickSeat(occupied: ReadonlySet<string>): string | null {
  return SEATS.find((s) => !occupied.has(s.id))?.id ?? null;
}

/** Next to the parent when that seat is free, else any free seat: a friend only stands when the lot is full. */
export function pickFriendSeat(parentSeat: string | null, occupied: ReadonlySet<string>): string | null {
  const def = parentSeat === null ? undefined : SEATS.find((s) => s.id === parentSeat);
  return def?.neighbours.find((n) => !occupied.has(n)) ?? pickSeat(occupied);
}
