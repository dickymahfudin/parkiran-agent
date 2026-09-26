import type { PublicSession } from "../../../shared/src/protocol.ts";
import type { Cue } from "../../../shared/src/session.ts";

export type Mood = "working" | "needs" | "idle" | "dozing" | "away" | "trouble";

export interface StateLabel {
  text: string;
  mood: Mood;
}

// Technical states keep their English names; the warung flavour is for what the character does.
const WORK_TEXT: Record<PublicSession["work"], string> = {
  think: "thinking",
  read: "reading",
  bash: "bash",
  edit: "editing",
  web: "browsing",
  agent: "subagent",
  other: "working",
};

export const MOOD_COLOR: Record<Mood, string> = {
  working: "#5cc8ff",
  needs: "#ff8a3d",
  idle: "#8fd694",
  dozing: "#b39ddb",
  away: "#9e9e9e",
  trouble: "#ff5c5c",
};

export function stateLabel(s: PublicSession, now: number): StateLabel {
  if (s.phase === "leaving") return { text: "pulang", mood: "away" };
  if (s.phase === "compacting") return { text: "compacting ☕", mood: "working" };
  if (s.need) {
    if (s.need.kind === "permission") return { text: "butuh korek 🔥", mood: "needs" };
    if (s.need.kind === "question") return { text: "question ❓", mood: "needs" };
    return { text: "needs input ✋", mood: "needs" };
  }
  if (s.lastOutcome?.kind === "failure" && now - s.lastOutcome.at < 4000) return { text: "error 😤", mood: "trouble" };
  if (s.phase === "working") return { text: WORK_TEXT[s.work], mood: "working" };
  if (s.dozing) return { text: "ketiduran 💤", mood: "dozing" };
  return { text: "idle", mood: "idle" };
}

export function cueText(cue: Cue): string {
  switch (cue.kind) {
    case "arrived":
      return "datang (session start)";
    case "needStarted":
      return cue.need === "permission" ? "cari korek (permission)" : cue.need === "question" ? "question" : "needs input";
    case "needReminder":
      return "masih cari korek";
    case "needResolved":
      return cue.outcome === "denied" ? "batal ngerokok (denied)" : cue.outcome === "answered" ? "answered" : "dikasih korek (approved)";
    case "failure":
      return cue.source === "tool" ? "tool failed" : "turn failed";
    case "turnDone":
      return "turn done";
    case "compactStarted":
      return "compacting, ke warung";
    case "compactDone":
      return "compact done, bawa kopi";
    case "friendArrived":
      return "subagent datang";
    case "friendLeft":
      return "subagent pulang";
    case "dozeStarted":
      return "ketiduran";
    case "woke":
      return "bangun";
    case "leaving":
      return "pamit (session end)";
    case "removed":
      return "hilang";
  }
}

export const shortId = (id: string): string => id.slice(0, 8);

export function formatAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}d`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}j ${m % 60}m`;
}

export function formatDuration(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ${m % 60} min` : `${Math.floor(h / 24)} d ${h % 24} h`;
}

/** Kampung parking tariff for the meter when no plan usage is available: per session, by started hour. */
const FEE_FIRST_HOUR = 2000;
const FEE_NEXT_HOUR = 1000;
const HOUR_MS = 3_600_000;

export interface ParkingFee {
  rupiah: number;
  sessions: number;
  /** Total time parked, all sessions together (ms). */
  parkedMs: number;
}

export function parkingFee(sessions: readonly Pick<PublicSession, "startedAt">[], now: number): ParkingFee {
  let rupiah = 0;
  let parkedMs = 0;
  for (const s of sessions) {
    const ms = Math.max(0, now - s.startedAt);
    parkedMs += ms;
    const hours = Math.max(1, Math.ceil(ms / HOUR_MS));
    rupiah += FEE_FIRST_HOUR + (hours - 1) * FEE_NEXT_HOUR;
  }
  return { rupiah, sessions: sessions.length, parkedMs };
}

/** "Rp 12.000" (Indonesian thousands separator). */
export function formatRupiah(value: number): string {
  return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}
