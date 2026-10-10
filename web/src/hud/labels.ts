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
  | "morning"
  | "evening"
  | "auto"
  | "milestone"
  | "collapse"
  | "expandList"
  | "close"
  | "settings";

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
  /** The Indonesian part of `text`, if any, so the page can mark its language for screen readers. */
  joke?: string;
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
      if (cue.need === "permission") return { icon: "permission", text: "cari korek (permission)", mood: "needs", joke: "cari korek" };
      return cue.need === "question" ? { icon: "question", text: "asked a question", mood: "needs" } : { icon: "input", text: "needs input", mood: "needs" };
    case "needReminder":
      if (session?.need?.kind === "permission") return { icon: "waiting", text: "masih cari korek (still waiting)", mood: "needs", joke: "masih cari korek" };
      return { icon: "waiting", text: "still waiting", mood: "needs" };
    case "needResolved":
      if (cue.outcome === "denied") return { icon: "denied", text: "batal ngerokok (denied)", mood: "trouble", joke: "batal ngerokok" };
      if (cue.outcome === "answered") return { icon: "answered", text: "answered", mood: "working" };
      return { icon: "approved", text: "dikasih korek (approved)", mood: "working", joke: "dikasih korek" };
    case "failure":
      return { icon: "error", text: cue.source === "tool" ? "tool failed" : "turn failed", mood: "trouble" };
    case "turnDone":
      return { icon: "done", text: "turn done", mood: "idle" };
    case "compactStarted":
      return { icon: "coffee", text: "compacting, ke warung", mood: "working", joke: "ke warung" };
    case "compactDone":
      return { icon: "coffee", text: "compact done, bawa kopi", mood: "idle", joke: "bawa kopi" };
    case "friendArrived":
      return { icon: "friendIn", text: "subagent joined", mood: "working" };
    case "friendLeft":
      return { icon: "friendOut", text: "subagent left", mood: "away" };
    case "milestone":
      if (cue.milestone === "compactions") return { icon: "milestone", text: milestoneText(cue.milestone, cue.value), mood: "working", joke: "kopi lagi" };
      return { icon: "milestone", text: milestoneText(cue.milestone, cue.value), mood: "working" };
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

const ordinal = (n: number): string =>
  `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;

function milestoneText(milestone: Extract<Cue, { kind: "milestone" }>["milestone"], value: number): string {
  if (milestone === "calls") return `${value} tool calls`;
  if (milestone === "work") return `${value} h of work`;
  return `${ordinal(value)} compaction, kopi lagi`;
}

/** From this many sessions on, the list switches to one line per session. */
export const DENSE_FROM = 6;

/**
 * List order: sessions waiting on the user first (longest waiting at the top), everyone else in arrival order, so rows
 * only move when a need starts or ends.
 */
export function orderSessions<T extends Pick<PublicSession, "id" | "need" | "startedAt">>(list: readonly T[]): T[] {
  const byStart = (a: T, b: T) => a.startedAt - b.startedAt || a.id.localeCompare(b.id);
  const waiting = list.filter((s) => s.need).sort((a, b) => a.need!.since - b.need!.since || byStart(a, b));
  return [...waiting, ...list.filter((s) => !s.need).sort(byStart)];
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

const MCP_TOOL = /^mcp__(.+?)__(.+)$/;

/**
 * Tool names as people read them: `mcp__Claude_Browser__javascript_tool` → "Claude Browser › javascript_tool". Plugin
 * servers (`plugin_<plugin>_<server>`) drop the prefix and a repeated name; id-like server names are shortened.
 */
export function formatToolName(name: string): string {
  const m = MCP_TOOL.exec(name);
  if (!m) return name;
  let server = m[1]!;
  if (server.startsWith("plugin_")) {
    server = server.slice("plugin_".length);
    const half = (server.length - 1) / 2;
    if (Number.isInteger(half) && server[half] === "_" && server.slice(0, half) === server.slice(half + 1)) server = server.slice(0, half);
  }
  if (/^[0-9a-f]{8}-[0-9a-f-]+$/i.test(server)) server = server.slice(0, 8);
  return `${server.replace(/_/g, " ")} › ${m[2]}`;
}

type Twin = Pick<PublicSession, "id" | "project" | "branch" | "startedAt">;
const twinKey = (s: Twin): string => `${s.project ?? ""}\u0000${s.branch ?? ""}`;

/**
 * Numbers for sessions that share a project and branch, so the lot can tell them apart (`#2`, `#3`). A number never
 * changes while its session and a twin are around; newcomers count on from the highest; a session left alone loses
 * its number. Pure: pass the previous result back in.
 */
export function assignTwinNumbers(previous: ReadonlyMap<string, number>, sessions: readonly Twin[]): Map<string, number> {
  const groups = new Map<string, Twin[]>();
  for (const s of sessions) {
    const g = groups.get(twinKey(s));
    if (g) g.push(s);
    else groups.set(twinKey(s), [s]);
  }
  const out = new Map<string, number>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
    let next = Math.max(0, ...group.map((s) => previous.get(s.id) ?? 0)) + 1;
    for (const s of group) out.set(s.id, previous.get(s.id) ?? next++);
  }
  return out;
}

/** Project name, with the twin number from `assignTwinNumbers` when it is #2 or later. */
export function sessionName(s: Pick<PublicSession, "id" | "project">, twins: ReadonlyMap<string, number>): string {
  const n = twins.get(s.id);
  const project = s.project ?? "?";
  return n && n > 1 ? `${project} #${n}` : project;
}

/** Event moods that belong under the feed's "Needs you" filter (and count while the feed is folded). */
export const ATTENTION_MOODS: ReadonlySet<Mood> = new Set<Mood>(["needs", "trouble"]);

/** How many attention events arrived after `seenSeq` (the newest cue when the feed was folded). */
export function unseenAttention(
  entries: readonly { cue: Cue; seq: number }[],
  seenSeq: number,
  sessions: Readonly<Record<string, Pick<PublicSession, "need">>>,
): number {
  let n = 0;
  for (const e of entries) if (e.seq > seenSeq && ATTENTION_MOODS.has(cueLine(e.cue, sessions[e.cue.sessionId]).mood)) n++;
  return n;
}

/** How old an event is, as the feed's section heading: "Just now", "1 min ago" … "10 min ago", then "Earlier". */
export function feedBucket(ageMs: number): string {
  if (ageMs < 60_000) return "Just now";
  const m = Math.floor(ageMs / 60_000);
  return m <= 10 ? `${m} min ago` : "Earlier";
}

/** One line of the grouped feed: one cue, or a run of alike cues merged into one with a count. */
export interface FeedGroup {
  /** The newest cue's `seq`: stable for React and new whenever the line gains a cue. */
  key: number;
  line: CueLine;
  /** Distinct sessions in the run, newest first. */
  sessionIds: string[];
  /** How many cues the line stands for. */
  count: number;
  /** When the newest of them arrived. */
  at: number;
}

export interface FeedSection {
  label: string;
  groups: FeedGroup[];
}

/**
 * The event feed as people read it: sections by age (`feedBucket`), and inside a section consecutive cues of the
 * same kind and outcome merged into one line ("4 sessions turn done", "blog turn done ×3"). Cues that need you or went
 * wrong are never merged: each one matters. `onlyAttention` keeps the "Needs you" lines. `entries` is newest first,
 * like the store's log. Pure.
 */
export function groupFeed(
  entries: readonly { cue: Cue; at: number; seq: number }[],
  now: number,
  sessions: Readonly<Record<string, Pick<PublicSession, "need">>>,
  onlyAttention = false,
): FeedSection[] {
  const sections: FeedSection[] = [];
  let mergeKey: string | null = null;
  for (const e of entries) {
    const line = cueLine(e.cue, sessions[e.cue.sessionId]);
    const attention = ATTENTION_MOODS.has(line.mood);
    if (onlyAttention && !attention) continue;
    const label = feedBucket(now - e.at);
    let section = sections.at(-1);
    if (section?.label !== label) {
      section = { label, groups: [] };
      sections.push(section);
      mergeKey = null;
    }
    // The text tells outcomes apart (approved / denied, tool / turn failed, a milestone's value).
    const key = attention ? null : `${e.cue.kind}\u0000${line.text}`;
    const last = section.groups.at(-1);
    if (key !== null && key === mergeKey && last) {
      last.count++;
      if (!last.sessionIds.includes(e.cue.sessionId)) last.sessionIds.push(e.cue.sessionId);
    } else {
      section.groups.push({ key: e.seq, line, sessionIds: [e.cue.sessionId], count: 1, at: e.at });
    }
    mergeKey = key;
  }
  return sections;
}

/** Who a feed line is about: the session's name, or "4 sessions" when the line merges several. */
export function feedSubject(group: Pick<FeedGroup, "sessionIds">, nameOf: (sessionId: string) => string): string {
  return group.sessionIds.length > 1 ? `${group.sessionIds.length} sessions` : nameOf(group.sessionIds[0] ?? "");
}
