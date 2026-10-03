// The detail panel's look back at a session: its last hour as a strip, its tool mix and how long it waited for you.
// Pure, unit tested.
import type { PublicSession } from "../../../shared/src/protocol.ts";
import { TIMELINE_WINDOW_MS } from "../../../shared/src/reducer.ts";
import type { TimelineEntry, TimelineState } from "../../../shared/src/session.ts";
import type { ToolGroup } from "../../../shared/src/tools.ts";

export const TIMELINE_STATES: readonly TimelineState[] = ["working", "waiting", "idle", "compacting"];

export const TIMELINE_LABEL: Record<TimelineState, string> = {
  working: "working",
  waiting: "waiting on you",
  idle: "idle",
  compacting: "compacting",
};

export const TIMELINE_COLOR: Record<TimelineState, string> = {
  working: "#5cc8ff",
  waiting: "#ff8a3d",
  idle: "#8fd694",
  compacting: "#c8a03a",
};

export interface Segment {
  state: TimelineState;
  /** Position and width in the window, 0…1 (left = `windowMs` ago, right = now). */
  start: number;
  width: number;
  ms: number;
}

/** The timeline cut to the last `windowMs`: one segment per state stretch, oldest first. */
export function timelineSegments(timeline: readonly TimelineEntry[], now: number, windowMs = TIMELINE_WINDOW_MS): Segment[] {
  const from = now - windowMs;
  const out: Segment[] = [];
  timeline.forEach((e, i) => {
    const a = Math.max(e.at, from);
    const b = Math.min(timeline[i + 1]?.at ?? now, now);
    if (b <= a) return;
    out.push({ state: e.state, start: (a - from) / windowMs, width: (b - a) / windowMs, ms: b - a });
  });
  return out;
}

/** Time per state in the window, in display order, empty states left out. */
export function timelineTotals(segments: readonly Segment[]): { state: TimelineState; ms: number }[] {
  return TIMELINE_STATES.map((state) => ({ state, ms: segments.filter((s) => s.state === state).reduce((n, s) => n + s.ms, 0) })).filter((t) => t.ms > 0);
}

/** Everything the session waited for the user, the need open right now included. */
export function waitedTotal(s: Pick<PublicSession, "waitedMs" | "need">, now: number): number {
  return s.waitedMs + (s.need ? Math.max(0, now - s.need.since) : 0);
}

const GROUP_LABEL: Record<ToolGroup, string> = { read: "read", edit: "edit", bash: "bash", web: "web", agent: "subagent", mcp: "MCP", other: "other" };
export const GROUP_COLOR: Record<ToolGroup, string> = {
  read: "#8fd694",
  edit: "#5cc8ff",
  bash: "#c8a03a",
  web: "#b39ddb",
  agent: "#e07a2e",
  mcp: "#f2a7c3",
  other: "#9aa3ad",
};

/** The tool mix, biggest first, with each group's share of all calls. */
export function toolMixRows(mix: Partial<Record<ToolGroup, number>>): { group: ToolGroup; label: string; count: number; share: number }[] {
  const total = Object.values(mix).reduce((n, c) => n + (c ?? 0), 0);
  if (total === 0) return [];
  return (Object.entries(mix) as [ToolGroup, number][])
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([group, count]) => ({ group, label: GROUP_LABEL[group], count, share: count / total }));
}

/** A span of time, short: "42s", "12m", "1h 5m". */
export function formatSpan(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
