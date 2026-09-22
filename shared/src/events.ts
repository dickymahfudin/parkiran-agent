export const HOOK_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PermissionDenied",
  "PostToolUse",
  "PostToolUseFailure",
  "Notification",
  "SubagentStart",
  "SubagentStop",
  "Stop",
  "StopFailure",
  "PreCompact",
  "PostCompact",
  "Elicitation",
  "ElicitationResult",
] as const;

export type HookEventName = (typeof HOOK_EVENTS)[number];

// SessionEnd runs synchronously so the event is delivered before the Claude Code process exits.
export const SYNC_HOOK_EVENTS: ReadonlySet<HookEventName> = new Set(["SessionEnd"]);

export const INGEST_VERSION = 1;

export const SESSION_START_SOURCES = ["startup", "resume", "clear", "compact", "fork"] as const;
export const SESSION_END_REASONS = ["clear", "resume", "logout", "prompt_input_exit", "other", "bypass_permissions_disabled"] as const;
export const COMPACT_TRIGGERS = ["manual", "auto"] as const;
export const STOP_FAILURE_ERRORS = [
  "rate_limit",
  "overloaded",
  "authentication_failed",
  "oauth_org_not_allowed",
  "account_on_hold",
  "billing_error",
  "invalid_request",
  "model_not_found",
  "server_error",
  "max_output_tokens",
  "cloud_credential_error",
  "unknown",
] as const;

export type SessionStartSource = (typeof SESSION_START_SOURCES)[number];
export type SessionEndReason = (typeof SESSION_END_REASONS)[number];
export type CompactTrigger = (typeof COMPACT_TRIGGERS)[number];
export type StopFailureError = (typeof STOP_FAILURE_ERRORS)[number];

/** The only data that ever leaves the relay. */
export interface IngestEvent {
  v: typeof INGEST_VERSION;
  event: HookEventName;
  sessionId: string;
  /** Epoch ms when the relay process started (closest proxy for when the hook fired). */
  ts: number;
  project: string | null;
  branch: string | null;
  toolName?: string;
  notificationType?: string;
  agentId?: string;
  agentType?: string;
  toolUseId?: string;
  /** SessionStart only. */
  source?: SessionStartSource;
  /** SessionEnd only. */
  endReason?: SessionEndReason;
  /** PreCompact / PostCompact only. */
  compactTrigger?: CompactTrigger;
  /** StopFailure only. */
  stopError?: StopFailureError;
  /** PostToolUseFailure only. */
  isInterrupt?: boolean;
}

export const INGEST_KEYS: ReadonlySet<string> = new Set([
  "v",
  "event",
  "sessionId",
  "ts",
  "project",
  "branch",
  "toolName",
  "notificationType",
  "agentId",
  "agentType",
  "toolUseId",
  "source",
  "endReason",
  "compactTrigger",
  "stopError",
  "isInterrupt",
]);

const HOOK_EVENT_SET: ReadonlySet<string> = new Set(HOOK_EVENTS);

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const TOOL_NAME_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const NOTIFICATION_TYPE_RE = /^[a-z][a-z0-9_]{0,63}$/;
const AGENT_TYPE_RE = /^[A-Za-z0-9_.:-]{0,64}$/;
// C0/C1 controls, zero-width and bidi override characters.
const UNSAFE_CHARS_RE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;

export const MAX_PROJECT_LEN = 64;
export const MAX_BRANCH_LEN = 100;

export function isHookEventName(value: unknown): value is HookEventName {
  return typeof value === "string" && HOOK_EVENT_SET.has(value);
}

export function isId(value: unknown): value is string {
  return typeof value === "string" && ID_RE.test(value);
}

export function isToolName(value: unknown): value is string {
  return typeof value === "string" && TOOL_NAME_RE.test(value);
}

export function isNotificationType(value: unknown): value is string {
  return typeof value === "string" && NOTIFICATION_TYPE_RE.test(value);
}

export function isAgentType(value: unknown): value is string {
  return typeof value === "string" && AGENT_TYPE_RE.test(value);
}

export function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

/** Strips invisible/control characters and clamps length. Returns null when nothing printable is left. */
export function cleanLabel(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(UNSAFE_CHARS_RE, "").trim();
  if (cleaned.length === 0) return null;
  return Array.from(cleaned).slice(0, maxLen).join("");
}

/** Strict validation used by the server: rejects unknown keys and malformed values. */
export function parseIngestEvent(value: unknown): IngestEvent | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) if (!INGEST_KEYS.has(key)) return null;

  if (obj.v !== INGEST_VERSION) return null;
  if (!isHookEventName(obj.event)) return null;
  if (!isId(obj.sessionId)) return null;
  if (typeof obj.ts !== "number" || !Number.isFinite(obj.ts) || obj.ts <= 0) return null;
  if (obj.project !== null && cleanLabel(obj.project, MAX_PROJECT_LEN) !== obj.project) return null;
  if (obj.branch !== null && cleanLabel(obj.branch, MAX_BRANCH_LEN) !== obj.branch) return null;

  const event: IngestEvent = {
    v: INGEST_VERSION,
    event: obj.event,
    sessionId: obj.sessionId,
    ts: obj.ts,
    project: obj.project as string | null,
    branch: obj.branch as string | null,
  };
  if (obj.toolName !== undefined) {
    if (!isToolName(obj.toolName)) return null;
    event.toolName = obj.toolName;
  }
  if (obj.notificationType !== undefined) {
    if (!isNotificationType(obj.notificationType)) return null;
    event.notificationType = obj.notificationType;
  }
  if (obj.agentId !== undefined) {
    if (!isId(obj.agentId)) return null;
    event.agentId = obj.agentId;
  }
  if (obj.agentType !== undefined) {
    if (!isAgentType(obj.agentType)) return null;
    event.agentType = obj.agentType;
  }
  if (obj.toolUseId !== undefined) {
    if (!isId(obj.toolUseId)) return null;
    event.toolUseId = obj.toolUseId;
  }
  if (obj.source !== undefined) {
    if (event.event !== "SessionStart" || !isOneOf(SESSION_START_SOURCES, obj.source)) return null;
    event.source = obj.source;
  }
  if (obj.endReason !== undefined) {
    if (event.event !== "SessionEnd" || !isOneOf(SESSION_END_REASONS, obj.endReason)) return null;
    event.endReason = obj.endReason;
  }
  if (obj.compactTrigger !== undefined) {
    if ((event.event !== "PreCompact" && event.event !== "PostCompact") || !isOneOf(COMPACT_TRIGGERS, obj.compactTrigger)) {
      return null;
    }
    event.compactTrigger = obj.compactTrigger;
  }
  if (obj.stopError !== undefined) {
    if (event.event !== "StopFailure" || !isOneOf(STOP_FAILURE_ERRORS, obj.stopError)) return null;
    event.stopError = obj.stopError;
  }
  if (obj.isInterrupt !== undefined) {
    if (event.event !== "PostToolUseFailure" || typeof obj.isInterrupt !== "boolean") return null;
    event.isInterrupt = obj.isInterrupt;
  }
  return event;
}
