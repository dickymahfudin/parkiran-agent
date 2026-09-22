import type { Cue, Session } from "./session.ts";

/** What the browser sees of a session: no internal bookkeeping. */
export type PublicSession = Omit<Session, "openTools" | "doneTools" | "lastStateTs">;

export function toPublicSession(s: Session): PublicSession {
  const { openTools: _o, doneTools: _d, lastStateTs: _l, ...rest } = s;
  return rest;
}

export interface UsageWindow {
  usedPercentage: number;
  resetsAt: number | null;
}

export type UsageSnapshot =
  | { available: false; reason: string }
  | { available: true; source: string; fiveHour: UsageWindow | null; sevenDay: UsageWindow | null; updatedAt: number };

export interface ClientConfig {
  lat: number;
  lon: number;
  idleMinutes: number;
}

export type ServerMessage =
  | { type: "hello"; serverTime: number; config: ClientConfig; sessions: PublicSession[]; usage: UsageSnapshot }
  | { type: "sessions"; serverTime: number; updated: PublicSession[]; removed: string[] }
  | { type: "cues"; serverTime: number; cues: Cue[] }
  | { type: "usage"; serverTime: number; usage: UsageSnapshot };
