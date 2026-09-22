import type { IngestEvent } from "./events.ts";
import { pickFriendSeat, pickSeat } from "./seats.ts";
import {
  DEFAULT_REDUCER_CONFIG,
  type Cue,
  type Need,
  type NeedKind,
  type ReducerConfig,
  type Session,
  type World,
} from "./session.ts";
import { QUESTION_TOOLS, workKindOf } from "./tools.ts";

const MAX_DONE_TOOLS = 64;
const MAX_OPEN_TOOLS = 64;
const OPEN_TOOL_TTL_MS = 60 * 60_000;

export interface ReduceResult {
  world: World;
  cues: Cue[];
}

export function occupiedSeats(world: World): Set<string> {
  const taken = new Set<string>();
  for (const s of Object.values(world.sessions)) {
    if (s.seat) taken.add(s.seat);
    for (const sub of Object.values(s.subagents)) if (sub.seat) taken.add(sub.seat);
  }
  return taken;
}

function cloneSession(s: Session): Session {
  return {
    ...s,
    need: s.need ? { ...s.need } : null,
    subagents: Object.fromEntries(Object.entries(s.subagents).map(([k, v]) => [k, { ...v }])),
    openTools: { ...s.openTools },
    doneTools: [...s.doneTools],
  };
}

function createSession(ev: IngestEvent, world: World): Session {
  return {
    id: ev.sessionId,
    project: ev.project,
    branch: ev.branch,
    seat: pickSeat(occupiedSeats(world)),
    phase: "idle",
    work: "think",
    currentTool: null,
    lastTool: null,
    need: null,
    lastOutcome: null,
    resumePhase: null,
    dozing: false,
    toolCalls: 0,
    failures: 0,
    startedAt: ev.ts,
    lastEventAt: ev.ts,
    lastEvent: ev.event,
    lastStateTs: Number.NEGATIVE_INFINITY,
    endedAt: null,
    subagents: {},
    openTools: {},
    doneTools: [],
  };
}

/** Pure: applies one sanitised hook event. Returns the new world and one-shot animation cues. */
export function reduce(world: World, ev: IngestEvent, config: ReducerConfig = DEFAULT_REDUCER_CONFIG): ReduceResult {
  const cues: Cue[] = [];
  const id = ev.sessionId;
  const existing = world.sessions[id];
  if (!existing && ev.event === "SessionEnd") return { world, cues };

  const s = existing ? cloneSession(existing) : createSession(ev, world);
  if (!existing) cues.push({ kind: "arrived", sessionId: id });
  const next: World = { sessions: { ...world.sessions, [id]: s } };

  if (ev.project !== null) s.project = ev.project;
  if (ev.branch !== null) s.branch = ev.branch;
  s.lastEventAt = Math.max(s.lastEventAt, ev.ts);
  s.lastEvent = ev.event;

  // Late events (out-of-order async delivery) still count and pair, but may not move the phase backwards.
  const live = ev.ts >= s.lastStateTs;
  const setPhase = (update: () => void): void => {
    if (!live) return;
    update();
    s.lastStateTs = ev.ts;
  };

  if (live && s.phase === "leaving" && ev.event !== "SessionEnd") {
    s.phase = "idle";
    s.endedAt = null;
    if (s.seat === null) s.seat = pickSeat(occupiedSeats(next));
    cues.push({ kind: "arrived", sessionId: id });
  }
  if (live && s.dozing) {
    s.dozing = false;
    cues.push({ kind: "woke", sessionId: id });
  }

  const startNeed = (kind: NeedKind, toolName: string | null, toolUseId: string | null): void => {
    if (s.need !== null) return;
    s.need = { kind, toolName, toolUseId, agentId: ev.agentId ?? null, since: ev.ts, reminded: false };
    cues.push({ kind: "needStarted", sessionId: id, need: kind });
    setPhase(() => {
      s.phase = "waiting";
    });
  };
  const resolveNeed = (outcome: "approved" | "answered" | "denied"): void => {
    const need = s.need;
    if (need === null) return;
    s.need = null;
    s.lastOutcome = { kind: outcome, at: ev.ts };
    if (outcome === "denied" && need.toolUseId) delete s.openTools[need.toolUseId];
    cues.push({ kind: "needResolved", sessionId: id, outcome });
    if (s.phase === "waiting") s.phase = "working";
  };
  const needMatches = (need: Need, toolUseId: string | undefined, toolName: string | undefined): boolean =>
    need.toolUseId !== null ? need.toolUseId === toolUseId : need.toolName === null || need.toolName === toolName;

  const subagent = ev.agentId !== undefined ? s.subagents[ev.agentId] : undefined;
  if (subagent) subagent.lastEventAt = Math.max(subagent.lastEventAt, ev.ts);

  switch (ev.event) {
    case "SessionStart":
      break;

    case "UserPromptSubmit":
      resolveNeed("denied");
      setPhase(() => {
        s.phase = "working";
        s.work = "think";
        s.currentTool = null;
      });
      break;

    case "PreToolUse": {
      if (ev.toolUseId) {
        if (s.doneTools.includes(ev.toolUseId)) break;
        s.openTools[ev.toolUseId] = { name: ev.toolName ?? "unknown", startedAt: ev.ts, agentId: ev.agentId ?? null };
        trimOpenTools(s);
      }
      const need = s.need;
      if (
        need?.kind === "permission" &&
        need.agentId === (ev.agentId ?? null) &&
        need.toolUseId !== null &&
        need.toolUseId !== ev.toolUseId &&
        s.openTools[need.toolUseId] !== undefined &&
        ev.ts - need.since >= config.denyAfterNewToolMs
      ) {
        resolveNeed("denied");
      }
      if (subagent) {
        subagent.work = workKindOf(ev.toolName);
        subagent.lastTool = ev.toolName ?? null;
        break;
      }
      if (ev.toolName !== undefined && QUESTION_TOOLS.has(ev.toolName)) {
        startNeed("question", ev.toolName, ev.toolUseId ?? null);
        break;
      }
      setPhase(() => {
        if (s.need === null && s.phase !== "compacting") s.phase = "working";
        s.work = workKindOf(ev.toolName);
        s.currentTool = ev.toolName ?? null;
      });
      break;
    }

    case "PermissionRequest": {
      const paired = pairOpenTool(s, ev.toolName, ev.agentId);
      if (s.need?.kind === "question" && s.need.toolName === ev.toolName) break;
      startNeed("permission", ev.toolName ?? null, paired);
      break;
    }

    case "PostToolUse":
    case "PostToolUseFailure": {
      const failed = ev.event === "PostToolUseFailure";
      if (ev.toolUseId) {
        delete s.openTools[ev.toolUseId];
        if (!s.doneTools.includes(ev.toolUseId)) {
          s.doneTools.push(ev.toolUseId);
          if (s.doneTools.length > MAX_DONE_TOOLS) s.doneTools.shift();
        }
      }
      s.toolCalls++;
      if (failed) s.failures++;
      if (s.need && needMatches(s.need, ev.toolUseId, ev.toolName)) {
        resolveNeed(s.need.kind === "permission" ? "approved" : "answered");
      }
      if (failed && ev.isInterrupt !== true) cues.push({ kind: "failure", sessionId: id, source: "tool" });
      if (subagent) {
        subagent.work = "think";
        subagent.lastTool = ev.toolName ?? subagent.lastTool;
        break;
      }
      s.lastTool = ev.toolName ?? s.lastTool;
      setPhase(() => {
        if (s.need === null && s.phase !== "compacting") s.phase = "working";
        s.work = "think";
        s.currentTool = null;
      });
      break;
    }

    case "PermissionDenied":
      if (ev.toolUseId) delete s.openTools[ev.toolUseId];
      if (s.need) resolveNeed("denied");
      else {
        s.lastOutcome = { kind: "denied", at: ev.ts };
        cues.push({ kind: "needResolved", sessionId: id, outcome: "denied" });
      }
      break;

    case "Notification":
      switch (ev.notificationType) {
        case "permission_prompt":
          if (s.need === null) startNeed("permission", null, null);
          else if (!s.need.reminded) {
            s.need.reminded = true;
            cues.push({ kind: "needReminder", sessionId: id });
          }
          break;
        case "elicitation_dialog":
        case "elicitation_url_dialog":
        case "agent_needs_input":
          startNeed("input", null, null);
          break;
        case "elicitation_complete":
        case "elicitation_response":
          if (s.need?.kind === "input") resolveNeed("answered");
          break;
        case "idle_prompt":
          resolveNeed("denied");
          setPhase(() => {
            if (s.phase === "working" || s.phase === "waiting") s.phase = "idle";
          });
          break;
        default:
          break;
      }
      break;

    case "Elicitation":
      startNeed("input", null, null);
      break;

    case "ElicitationResult":
      if (s.need?.kind === "input") resolveNeed("answered");
      break;

    case "SubagentStart":
      if (ev.agentId !== undefined && !s.subagents[ev.agentId]) {
        s.subagents[ev.agentId] = {
          id: ev.agentId,
          type: ev.agentType ?? "",
          seat: pickFriendSeat(s.seat, occupiedSeats(next)),
          startedAt: ev.ts,
          lastEventAt: ev.ts,
          work: "think",
          lastTool: null,
        };
        cues.push({ kind: "friendArrived", sessionId: id, agentId: ev.agentId });
      }
      break;

    case "SubagentStop":
      if (subagent) {
        delete s.subagents[subagent.id];
        cues.push({ kind: "friendLeft", sessionId: id, agentId: subagent.id });
      } else if (!ev.agentType) {
        // Internal agent (prompt suggestion, /btw) runs once a turn has ended.
        resolveNeed("denied");
      }
      break;

    case "Stop":
      resolveNeed("denied");
      setPhase(() => {
        if (s.phase !== "compacting") s.phase = "idle";
        s.work = "think";
        s.currentTool = null;
      });
      cues.push({ kind: "turnDone", sessionId: id });
      break;

    case "StopFailure":
      resolveNeed("denied");
      s.lastOutcome = { kind: "failure", at: ev.ts };
      setPhase(() => {
        if (s.phase !== "compacting") s.phase = "idle";
        s.currentTool = null;
      });
      cues.push({ kind: "failure", sessionId: id, source: "turn" });
      break;

    case "PreCompact":
      setPhase(() => {
        if (s.phase === "compacting") return;
        s.resumePhase = s.phase;
        s.phase = "compacting";
        cues.push({ kind: "compactStarted", sessionId: id });
      });
      break;

    case "PostCompact":
      if (s.phase === "compacting") {
        s.phase = s.resumePhase === "waiting" && s.need === null ? "working" : (s.resumePhase ?? "idle");
        s.resumePhase = null;
        s.lastStateTs = Math.max(s.lastStateTs, ev.ts);
        cues.push({ kind: "compactDone", sessionId: id });
      }
      break;

    case "SessionEnd":
      s.need = null;
      for (const sub of Object.keys(s.subagents)) cues.push({ kind: "friendLeft", sessionId: id, agentId: sub });
      s.subagents = {};
      s.phase = "leaving";
      s.endedAt = ev.ts;
      s.lastStateTs = Math.max(s.lastStateTs, ev.ts);
      cues.push({ kind: "leaving", sessionId: id });
      break;
  }

  return { world: next, cues };
}

function pairOpenTool(s: Session, toolName: string | undefined, agentId: string | undefined): string | null {
  let best: { id: string; startedAt: number } | null = null;
  for (const [id, t] of Object.entries(s.openTools)) {
    if (t.name !== toolName || t.agentId !== (agentId ?? null)) continue;
    if (!best || t.startedAt > best.startedAt) best = { id, startedAt: t.startedAt };
  }
  return best?.id ?? null;
}

function trimOpenTools(s: Session): void {
  const entries = Object.entries(s.openTools);
  if (entries.length <= MAX_OPEN_TOOLS) return;
  entries.sort((a, b) => a[1].startedAt - b[1].startedAt);
  for (const [id] of entries.slice(0, entries.length - MAX_OPEN_TOOLS)) delete s.openTools[id];
}

/** Pure: time-based transitions (dozing, reaping, removal after the exit walk, stale friends). */
export function tick(world: World, now: number, config: ReducerConfig = DEFAULT_REDUCER_CONFIG): ReduceResult {
  const cues: Cue[] = [];
  let changed = false;
  const sessions: Record<string, Session> = {};
  for (const [id, original] of Object.entries(world.sessions)) {
    if (original.phase === "leaving" && original.endedAt !== null && now - original.endedAt >= config.leaveMs) {
      cues.push({ kind: "removed", sessionId: id });
      changed = true;
      continue;
    }
    let s = original;
    const edit = (): Session => {
      if (s === original) {
        s = cloneSession(original);
        changed = true;
      }
      return s;
    };
    if (s.phase !== "leaving" && now - s.lastEventAt >= config.reapMs) {
      const e = edit();
      e.phase = "leaving";
      e.endedAt = now;
      e.need = null;
      for (const sub of Object.keys(e.subagents)) cues.push({ kind: "friendLeft", sessionId: id, agentId: sub });
      e.subagents = {};
      cues.push({ kind: "leaving", sessionId: id });
    }
    if (s.phase === "idle" && !s.dozing && now - s.lastEventAt >= config.idleMs) {
      edit().dozing = true;
      cues.push({ kind: "dozeStarted", sessionId: id });
    }
    for (const sub of Object.values(s.subagents)) {
      if (now - sub.lastEventAt >= config.subagentStaleMs) {
        delete edit().subagents[sub.id];
        cues.push({ kind: "friendLeft", sessionId: id, agentId: sub.id });
      }
    }
    for (const [toolId, t] of Object.entries(s.openTools)) {
      if (now - t.startedAt >= OPEN_TOOL_TTL_MS) delete edit().openTools[toolId];
    }
    sessions[id] = s;
  }
  return { world: changed ? { sessions } : world, cues };
}
