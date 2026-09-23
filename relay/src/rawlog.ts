import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { LOG_DIR } from "./config.ts";

const MAX_LOG_BYTES = 5 * 1024 * 1024;
const MAX_DEPTH = 2;
const IDENT_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,47}$/;
const SAFE_VALUE_RE = /^[A-Za-z0-9_.:\- ]{0,64}$/;

// Top-level fields whose values are closed enums or identifiers, safe to show in the local shape log.
const SAFE_VALUE_KEYS: ReadonlySet<string> = new Set([
  "hook_event_name",
  "session_id",
  "notification_type",
  "tool_name",
  "tool_use_id",
  "agent_id",
  "agent_type",
  "source",
  "trigger",
  "permission_mode",
  "stop_hook_active",
  "is_interrupt",
  "duration_ms",
  "model",
]);
// Same key name carries free text on other events (e.g. PermissionDenied.reason, PostToolUseFailure.error).
const SAFE_VALUE_KEYS_BY_EVENT: Readonly<Record<string, ReadonlySet<string>>> = {
  SessionEnd: new Set(["reason"]),
  StopFailure: new Set(["error"]),
};

export type Shape = string | number | boolean | null | Shape[] | { [key: string]: Shape };

/** Describes structure (keys, types, lengths) without carrying content. */
export function describeShape(value: unknown, depth = 0): Shape {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return `string(${value.length})`;
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "object": {
      if (Array.isArray(value)) {
        if (depth >= MAX_DEPTH || value.length === 0) return `array(${value.length})`;
        return [`array(${value.length})`, describeShape(value[0], depth + 1)];
      }
      const entries = Object.entries(value as Record<string, unknown>);
      if (depth >= MAX_DEPTH) return `object(${entries.length} keys)`;
      const out: Record<string, Shape> = {};
      let hidden = 0;
      for (const [k, v] of entries) {
        if (IDENT_KEY_RE.test(k)) out[k] = describeShape(v, depth + 1);
        else hidden++;
      }
      if (hidden > 0) out["<non-identifier keys>"] = hidden;
      return out;
    }
    default:
      return typeof value;
  }
}

export function describeRawEvent(raw: unknown): Record<string, Shape> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { "<payload>": describeShape(raw) };
  const payload = raw as Record<string, unknown>;
  const eventName = typeof payload.hook_event_name === "string" ? payload.hook_event_name : "";
  const extra = SAFE_VALUE_KEYS_BY_EVENT[eventName];
  const out: Record<string, Shape> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (!IDENT_KEY_RE.test(k)) {
      out["<non-identifier keys>"] = ((out["<non-identifier keys>"] as number | undefined) ?? 0) + 1;
      continue;
    }
    const safe = SAFE_VALUE_KEYS.has(k) || extra?.has(k) === true;
    const showValue =
      safe && (typeof v === "boolean" || typeof v === "number" || (typeof v === "string" && SAFE_VALUE_RE.test(v)));
    out[k] = showValue ? (v as string | number | boolean) : describeShape(v, 1);
  }
  return out;
}

export function appendLog(fileName: string, line: string): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
    const path = join(LOG_DIR, fileName);
    try {
      if (statSync(path).size > MAX_LOG_BYTES) renameSync(path, `${path}.old`);
    } catch {
      // file does not exist yet
    }
    appendFileSync(path, `${line}\n`, { mode: 0o600 });
  } catch {
    // logging must never affect the hook
  }
}
