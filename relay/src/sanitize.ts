import {
  COMPACT_TRIGGERS,
  INGEST_VERSION,
  MAX_BRANCH_LEN,
  MAX_PROJECT_LEN,
  cleanLabel,
  isAgentType,
  isHookEventName,
  isId,
  isNotificationType,
  isOneOf,
  isToolName,
  SESSION_END_REASONS,
  SESSION_START_SOURCES,
  STOP_FAILURE_ERRORS,
  type IngestEvent,
} from "../../shared/src/events.ts";

export interface RepoInfo {
  /** Basename only. Never a path. */
  project: string | null;
  branch: string | null;
}

export type RepoResolver = (cwd: string) => RepoInfo;

/**
 * Builds the outgoing event from scratch out of an allowlist. Nothing from the raw payload is
 * copied wholesale, so unknown or future fields (tool_input, prompt, ...) can never leak.
 */
export function buildIngestEvent(raw: unknown, ts: number, resolveRepo: RepoResolver): IngestEvent | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const payload = raw as Record<string, unknown>;

  const eventName = payload.hook_event_name;
  if (!isHookEventName(eventName)) return null;
  const sessionId = payload.session_id;
  if (!isId(sessionId)) return null;

  const repo: RepoInfo = typeof payload.cwd === "string" && payload.cwd.length > 0 ? resolveRepo(payload.cwd) : { project: null, branch: null };

  const event: IngestEvent = {
    v: INGEST_VERSION,
    event: eventName,
    sessionId,
    ts,
    project: cleanLabel(repo.project, MAX_PROJECT_LEN),
    branch: cleanLabel(repo.branch, MAX_BRANCH_LEN),
  };

  if (isToolName(payload.tool_name)) event.toolName = payload.tool_name;
  if (eventName === "Notification" && isNotificationType(payload.notification_type)) {
    event.notificationType = payload.notification_type;
  }
  if (isId(payload.agent_id)) event.agentId = payload.agent_id;
  if (isAgentType(payload.agent_type)) event.agentType = payload.agent_type;
  if (isId(payload.tool_use_id)) event.toolUseId = payload.tool_use_id;

  // Same raw key names carry free text on other events, so each enum is read only where it is an enum.
  if (eventName === "SessionStart" && isOneOf(SESSION_START_SOURCES, payload.source)) event.source = payload.source;
  if (eventName === "SessionEnd" && isOneOf(SESSION_END_REASONS, payload.reason)) event.endReason = payload.reason;
  if ((eventName === "PreCompact" || eventName === "PostCompact") && isOneOf(COMPACT_TRIGGERS, payload.trigger)) {
    event.compactTrigger = payload.trigger;
  }
  if (eventName === "StopFailure" && isOneOf(STOP_FAILURE_ERRORS, payload.error)) event.stopError = payload.error;
  if (eventName === "PostToolUseFailure" && typeof payload.is_interrupt === "boolean") {
    event.isInterrupt = payload.is_interrupt;
  }

  return event;
}
