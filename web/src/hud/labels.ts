import type { PublicSession } from "../../../shared/src/protocol.ts";
import type { Cue } from "../../../shared/src/session.ts";

export type Mood = "working" | "needs" | "idle" | "dozing" | "away" | "trouble";

/** Icons the HUD draws (`hud/icons.tsx`); named here so the labels stay plain data. */
export type IconName =
  | "arrived"
  | "permission"
  | "question"
  | "input"
  | "waiting"
  | "approved"
  | "denied"
  | "answered"
  | "error"
  | "done"
  | "coffee"
  | "friendIn"
  | "friendOut"
  | "dozing"
  | "woke"
  | "leaving"
  | "gone"
  | "reset"
  | "compact"
  | "expand"
  | "soundOn"
  | "soundOff"
  | "bellOn"
  | "bellOff"
  | "day"
  | "night"
  | "close";

export interface StateLabel {
  text: string;
  mood: Mood;
  icon: IconName | null;
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
  if (s.phase === "leaving") return { text: "leaving", mood: "away", icon: "leaving" };
  if (s.phase === "compacting") return { text: "compacting", mood: "working", icon: "coffee" };
  if (s.need) return { text: NEED_TEXT[s.need.kind], mood: "needs", icon: NEED_ICON[s.need.kind] };
  if (s.lastOutcome?.kind === "failure" && now - s.lastOutcome.at < 4000) return { text: "error", mood: "trouble", icon: "error" };
  if (s.phase === "working") return { text: WORK_TEXT[s.work], mood: "working", icon: null };
  if (s.dozing) return { text: "dozing", mood: "dozing", icon: "dozing" };
  return { text: "idle", mood: "idle", icon: null };
}

type NeedKind = NonNullable<PublicSession["need"]>["kind"];

const NEED_TEXT: Record<NeedKind, string> = {
  permission: "permission",
  question: "question",
  input: "needs input",
};

export const NEED_ICON: Record<NeedKind, IconName> = {
  permission: "permission",
  question: "question",
  input: "input",
};

export interface CueLine {
  icon: IconName;
  text: string;
  mood: Mood;
}

/**
 * One line of the event feed. Plain facts are English; the smoking jokes (a permission prompt is a cigarette waiting
 * for a lighter) stay Indonesian. `session` is the session as it is now, for cues that carry no detail of their own.
 */
export function cueLine(cue: Cue, session?: Pick<PublicSession, "need">): CueLine {
  switch (cue.kind) {
    case "arrived":
      return { icon: "arrived", text: "session started", mood: "idle" };
    case "needStarted":
      if (cue.need === "permission") return { icon: "permission", text: "cari korek (permission)", mood: "needs" };
      return cue.need === "question" ? { icon: "question", text: "asked a question", mood: "needs" } : { icon: "input", text: "needs input", mood: "needs" };
    case "needReminder":
      return { icon: "waiting", text: session?.need?.kind === "permission" ? "masih cari korek (still waiting)" : "still waiting", mood: "needs" };
    case "needResolved":
      if (cue.outcome === "denied") return { icon: "denied", text: "batal ngerokok (denied)", mood: "trouble" };
      return cue.outcome === "answered" ? { icon: "answered", text: "answered", mood: "working" } : { icon: "approved", text: "dikasih korek (approved)", mood: "working" };
    case "failure":
      return { icon: "error", text: cue.source === "tool" ? "tool failed" : "turn failed", mood: "trouble" };
    case "turnDone":
      return { icon: "done", text: "turn done", mood: "idle" };
    case "compactStarted":
      return { icon: "coffee", text: "compacting, ke warung", mood: "working" };
    case "compactDone":
      return { icon: "coffee", text: "compact done, bawa kopi", mood: "idle" };
    case "friendArrived":
      return { icon: "friendIn", text: "subagent joined", mood: "working" };
    case "friendLeft":
      return { icon: "friendOut", text: "subagent left", mood: "away" };
    case "dozeStarted":
      return { icon: "dozing", text: "dozed off", mood: "dozing" };
    case "woke":
      return { icon: "woke", text: "woke up", mood: "idle" };
    case "leaving":
      return { icon: "leaving", text: "session ended", mood: "away" };
    case "removed":
      return { icon: "gone", text: "left the lot", mood: "away" };
  }
}

/** Needs first: those are what the user acts on. */
const MOOD_ORDER: Mood[] = ["needs", "trouble", "working", "idle", "dozing", "away"];

export const MOOD_NAME: Record<Mood, string> = {
  needs: "needs you",
  trouble: "error",
  working: "working",
  idle: "idle",
  dozing: "dozing",
  away: "leaving",
};

/** How many sessions are in each mood, in display order, empty moods left out. */
export function moodCounts(sessions: readonly PublicSession[], now: number): { mood: Mood; count: number }[] {
  const counts = new Map<Mood, number>();
  for (const s of sessions) {
    const mood = stateLabel(s, now).mood;
    counts.set(mood, (counts.get(mood) ?? 0) + 1);
  }
  return MOOD_ORDER.filter((m) => counts.has(m)).map((mood) => ({ mood, count: counts.get(mood)! }));
}

export const shortId = (id: string): string => id.slice(0, 8);

export function formatAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return "now";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function formatDuration(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ${m % 60} min` : `${Math.floor(h / 24)} d ${h % 24} h`;
}
