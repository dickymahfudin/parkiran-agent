import type { HookEventName } from "./events.ts";
import type { ToolGroup, WorkKind } from "./tools.ts";

export type Phase = "working" | "waiting" | "idle" | "compacting" | "leaving";
export type NeedKind = "permission" | "question" | "input";
export type Outcome = "approved" | "answered" | "denied" | "failure";

export interface Need {
  kind: NeedKind;
  toolName: string | null;
  /** Paired PreToolUse id; PermissionRequest itself carries none. */
  toolUseId: string | null;
  agentId: string | null;
  since: number;
  reminded: boolean;
}

export interface Subagent {
  id: string;
  type: string;
  seat: string | null;
  startedAt: number;
  lastEventAt: number;
  work: WorkKind;
  lastTool: string | null;
}

/** A session's state as the timeline shows it: thinking and tool calls alternate every few seconds, so both are work. */
export type TimelineState = "working" | "waiting" | "idle" | "compacting";

export interface TimelineEntry {
  state: TimelineState;
  at: number;
}

export type Milestone = "calls" | "work" | "compactions";

export interface OpenTool {
  name: string;
  startedAt: number;
  agentId: string | null;
}

export interface Session {
  id: string;
  project: string | null;
  branch: string | null;
  seat: string | null;
  phase: Phase;
  work: WorkKind;
  currentTool: string | null;
  lastTool: string | null;
  need: Need | null;
  lastOutcome: { kind: Outcome; at: number } | null;
  /** Phase to return to after a compaction trip to the warung. */
  resumePhase: Phase | null;
  dozing: boolean;
  toolCalls: number;
  failures: number;
  /** Finished compactions (kopi runs): the empty cups stack up by the seat. */
  compactions: number;
  /** Finished tool calls by group (subagents included, like `toolCalls`). */
  toolMix: Partial<Record<ToolGroup, number>>;
  /** Times the session asked the user for something (permission, question, input). */
  asks: number;
  /** Total time the session waited for the user on handled needs (ms); an open need adds `now − need.since`. */
  waitedMs: number;
  /** State changes over roughly the last hour (oldest first; the first entry may start before the hour). */
  timeline: TimelineEntry[];
  /** Time spent working before the current timeline entry (ms), for the work milestones. */
  workedMs: number;
  /** Milestones already announced, e.g. "calls:100". */
  milestones: string[];
  startedAt: number;
  lastEventAt: number;
  lastEvent: HookEventName;
  /** ts of the last event allowed to change phase; older (late) events only update counters. */
  lastStateTs: number;
  endedAt: number | null;
  subagents: Record<string, Subagent>;
  openTools: Record<string, OpenTool>;
  doneTools: string[];
}

export interface World {
  sessions: Record<string, Session>;
}

export type Cue =
  | { kind: "arrived"; sessionId: string }
  | { kind: "needStarted"; sessionId: string; need: NeedKind }
  | { kind: "needReminder"; sessionId: string }
  | { kind: "needResolved"; sessionId: string; outcome: "approved" | "answered" | "denied" }
  | { kind: "failure"; sessionId: string; source: "tool" | "turn" }
  | { kind: "turnDone"; sessionId: string }
  | { kind: "compactStarted"; sessionId: string }
  | { kind: "compactDone"; sessionId: string }
  | { kind: "friendArrived"; sessionId: string; agentId: string }
  | { kind: "friendLeft"; sessionId: string; agentId: string }
  | { kind: "milestone"; sessionId: string; milestone: Milestone; value: number }
  | { kind: "dozeStarted"; sessionId: string }
  | { kind: "woke"; sessionId: string }
  | { kind: "leaving"; sessionId: string }
  | { kind: "removed"; sessionId: string };

export interface ReducerConfig {
  /** Idle this long → dozes off. */
  idleMs: number;
  /** No events at all this long → walks away. */
  reapMs: number;
  /** Exit animation time before a leaving session is removed and its seat freed. */
  leaveMs: number;
  /** Friend without events this long → leaves (SubagentStop may never come). */
  subagentStaleMs: number;
  /** A new tool starting this long after an unanswered permission means it was denied with feedback. */
  denyAfterNewToolMs: number;
}

export const DEFAULT_REDUCER_CONFIG: ReducerConfig = {
  idleMs: 30 * 60_000,
  reapMs: 12 * 60 * 60_000,
  leaveMs: 12_000,
  subagentStaleMs: 30 * 60_000,
  denyAfterNewToolMs: 500,
};

export const EMPTY_WORLD: World = { sessions: {} };
