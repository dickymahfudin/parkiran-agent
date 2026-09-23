import { describe, expect, test } from "bun:test";
import { INGEST_KEYS, cleanLabel, parseIngestEvent } from "../../shared/src/events.ts";
import { describeRawEvent } from "../src/rawlog.ts";
import { buildIngestEvent, type RepoResolver } from "../src/sanitize.ts";
import { CWD, PAYLOADS, SECRET, SESSION } from "./fixtures.ts";

const TS = 1_760_000_000_000;
const resolver: RepoResolver = () => ({ project: "my-project", branch: "feature/korek" });

// Raw keys whose (validated) values may be forwarded. Everything else must never appear in the output.
const FORWARDABLE_RAW_KEYS = new Set([
  "hook_event_name",
  "session_id",
  "tool_name",
  "notification_type",
  "agent_id",
  "agent_type",
  "tool_use_id",
]);
const FORWARDABLE_BY_EVENT: Record<string, string[]> = {
  SessionStart: ["source"],
  SessionEnd: ["reason"],
  PreCompact: ["trigger"],
  PostCompact: ["trigger"],
  StopFailure: ["error"],
  PostToolUseFailure: ["is_interrupt"],
};
const forwardable = (payload: Record<string, unknown>, key: string): boolean =>
  FORWARDABLE_RAW_KEYS.has(key) || FORWARDABLE_BY_EVENT[String(payload.hook_event_name)]?.includes(key) === true;

function collectStringValues(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStringValues(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) collectStringValues(v, out);
  return out;
}

describe("buildIngestEvent", () => {
  for (const [name, payload] of Object.entries(PAYLOADS)) {
    test(`${name}: forwards only allowlisted keys and no secret content`, () => {
      const event = buildIngestEvent(payload, TS, resolver);
      expect(event).not.toBeNull();
      for (const key of Object.keys(event!)) expect(INGEST_KEYS.has(key)).toBe(true);
      const wire = JSON.stringify(event);
      expect(wire).not.toContain(SECRET);
      expect(wire).not.toContain("/Users/");
      expect(wire).not.toContain(CWD);
      expect(parseIngestEvent(JSON.parse(wire))).toEqual(event!);
    });
  }

  test("every non-forwardable raw value is absent, even under hostile values", () => {
    for (const payload of Object.values(PAYLOADS)) {
      const hostile: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(payload)) {
        hostile[k] = forwardable(payload, k) ? v : { nested: [`${SECRET}-${k}`, { deep: SECRET }], [SECRET]: 1 };
      }
      hostile.cwd = CWD;
      const event = buildIngestEvent(hostile, TS, resolver);
      const wire = JSON.stringify(event);
      expect(wire).not.toContain(SECRET);
      const original = buildIngestEvent(payload, TS, resolver);
      const originalWire = JSON.stringify(original);
      for (const [k, v] of Object.entries(payload)) {
        if (forwardable(payload, k)) continue;
        for (const s of collectStringValues(v)) if (s.length >= 8) expect(originalWire).not.toContain(s);
      }
    }
  });

  test("unknown future fields are dropped", () => {
    const event = buildIngestEvent(
      { ...PAYLOADS.Stop, brand_new_field: SECRET, tool_input: SECRET, tool_response: SECRET, prompt: SECRET },
      TS,
      resolver,
    );
    expect(JSON.stringify(event)).not.toContain(SECRET);
  });

  test("forwards the expected fields", () => {
    expect(buildIngestEvent(PAYLOADS.SubagentToolCall, TS, resolver)).toEqual({
      v: 1,
      event: "PreToolUse",
      sessionId: SESSION,
      ts: TS,
      project: "my-project",
      branch: "feature/korek",
      toolName: "Read",
      agentId: "agent-def456",
      agentType: "my-plugin:reviewer",
      toolUseId: "toolu_01ABC127",
    });
    expect(buildIngestEvent(PAYLOADS.Notification, TS, resolver)?.notificationType).toBe("permission_prompt");
    expect(buildIngestEvent(PAYLOADS.SessionStart, TS, resolver)?.source).toBe("startup");
    expect(buildIngestEvent(PAYLOADS.SessionEnd, TS, resolver)?.endReason).toBe("other");
    expect(buildIngestEvent(PAYLOADS.PreCompact, TS, resolver)?.compactTrigger).toBe("manual");
    expect(buildIngestEvent(PAYLOADS.PostCompact, TS, resolver)?.compactTrigger).toBe("auto");
    expect(buildIngestEvent(PAYLOADS.StopFailure, TS, resolver)?.stopError).toBe("rate_limit");
    expect(buildIngestEvent(PAYLOADS.PostToolUseFailure, TS, resolver)?.isInterrupt).toBe(false);
    expect(buildIngestEvent(PAYLOADS.PermissionRequest, TS, resolver)?.toolUseId).toBeUndefined();
  });

  test("enum fields are only read on the event where they are enums", () => {
    const denied = buildIngestEvent(PAYLOADS.PermissionDenied, TS, resolver)!;
    expect(denied.endReason).toBeUndefined();
    expect(JSON.stringify(denied)).not.toContain("Irreversible");
    const failure = buildIngestEvent(PAYLOADS.PostToolUseFailure, TS, resolver)!;
    expect(failure.stopError).toBeUndefined();
    expect(JSON.stringify(failure)).not.toContain("Exit code");
    expect(buildIngestEvent({ ...PAYLOADS.Stop, source: "startup", trigger: "auto", is_interrupt: true }, TS, resolver)).toEqual(
      buildIngestEvent(PAYLOADS.Stop, TS, resolver),
    );
  });

  test("unknown enum values are dropped, not passed through", () => {
    expect(buildIngestEvent({ ...PAYLOADS.SessionStart, source: SECRET }, TS, resolver)?.source).toBeUndefined();
    expect(buildIngestEvent({ ...PAYLOADS.SessionEnd, reason: `other ${SECRET}` }, TS, resolver)?.endReason).toBeUndefined();
    expect(buildIngestEvent({ ...PAYLOADS.StopFailure, error: "brand_new_error" }, TS, resolver)?.stopError).toBeUndefined();
    expect(buildIngestEvent({ ...PAYLOADS.PostToolUseFailure, is_interrupt: "yes" }, TS, resolver)?.isInterrupt).toBeUndefined();
  });

  test("drops allowlisted fields that carry unexpected content", () => {
    const event = buildIngestEvent(
      {
        ...PAYLOADS.PreToolUse,
        tool_name: `Bash; echo ${SECRET}`,
        agent_id: `../${SECRET}`,
        agent_type: `${SECRET} with spaces`,
      },
      TS,
      resolver,
    );
    expect(event).not.toBeNull();
    expect(event!.toolName).toBeUndefined();
    expect(event!.agentId).toBeUndefined();
    expect(event!.agentType).toBeUndefined();
  });

  test("notification_type is only read on Notification events", () => {
    expect(buildIngestEvent({ ...PAYLOADS.Stop, notification_type: "permission_prompt" }, TS, resolver)?.notificationType).toBeUndefined();
  });

  test("rejects payloads without a valid event name or session id", () => {
    expect(buildIngestEvent({ ...PAYLOADS.Stop, hook_event_name: "MadeUp" }, TS, resolver)).toBeNull();
    expect(buildIngestEvent({ ...PAYLOADS.Stop, session_id: `${SECRET}/../x` }, TS, resolver)).toBeNull();
    expect(buildIngestEvent({ ...PAYLOADS.Stop, session_id: undefined }, TS, resolver)).toBeNull();
    expect(buildIngestEvent(null, TS, resolver)).toBeNull();
    expect(buildIngestEvent([PAYLOADS.Stop], TS, resolver)).toBeNull();
    expect(buildIngestEvent("Stop", TS, resolver)).toBeNull();
  });

  test("the resolver only receives cwd and its output is cleaned", () => {
    const seen: string[] = [];
    const event = buildIngestEvent(PAYLOADS.Stop, TS, (cwd) => {
      seen.push(cwd);
      return { project: "proj‮\u0007name", branch: "  main\n" };
    });
    expect(seen).toEqual([CWD]);
    expect(event?.project).toBe("projname");
    expect(event?.branch).toBe("main");
  });

  test("missing cwd gives null project and branch", () => {
    const { cwd: _cwd, ...noCwd } = PAYLOADS.Stop!;
    const event = buildIngestEvent(noCwd, TS, () => {
      throw new Error("resolver must not be called");
    });
    expect(event?.project).toBeNull();
    expect(event?.branch).toBeNull();
  });
});

describe("cleanLabel", () => {
  test("strips control, zero-width and bidi characters and clamps length", () => {
    expect(cleanLabel("a\u0000b​c‮d⁦e", 64)).toBe("abcde");
    expect(cleanLabel("x".repeat(200), 64)).toHaveLength(64);
    expect(cleanLabel("\u0007\n ", 64)).toBeNull();
    expect(cleanLabel(42, 64)).toBeNull();
  });
});

describe("parseIngestEvent (server-side validation)", () => {
  const valid = buildIngestEvent(PAYLOADS.PreToolUse, TS, resolver)!;

  test("rejects extra keys", () => {
    expect(parseIngestEvent({ ...valid, prompt: SECRET })).toBeNull();
    expect(parseIngestEvent({ ...valid, toolInput: {} })).toBeNull();
  });

  test("rejects malformed values", () => {
    expect(parseIngestEvent({ ...valid, v: 2 })).toBeNull();
    expect(parseIngestEvent({ ...valid, ts: "now" })).toBeNull();
    expect(parseIngestEvent({ ...valid, project: "a\u0000b" })).toBeNull();
    expect(parseIngestEvent({ ...valid, toolName: "rm -rf" })).toBeNull();
    expect(parseIngestEvent({ ...valid, event: "Nope" })).toBeNull();
    expect(parseIngestEvent({ ...valid, toolUseId: "../x" })).toBeNull();
  });

  test("rejects enum fields on the wrong event or with unknown values", () => {
    expect(parseIngestEvent({ ...valid, source: "startup" })).toBeNull();
    expect(parseIngestEvent({ ...valid, isInterrupt: true })).toBeNull();
    const start = buildIngestEvent(PAYLOADS.SessionStart, TS, resolver)!;
    expect(parseIngestEvent(start)).toEqual(start);
    expect(parseIngestEvent({ ...start, source: "teleport" })).toBeNull();
  });
});

describe("raw-event shape log", () => {
  for (const [name, payload] of Object.entries(PAYLOADS)) {
    test(`${name}: shows structure but no free text`, () => {
      const shape = JSON.stringify(describeRawEvent(payload));
      expect(shape).not.toContain(SECRET);
      expect(shape).not.toContain("/Users/");
      expect(shape).toContain(String(payload.hook_event_name));
    });
  }

  test("shows closed-enum values only where they are enums", () => {
    expect(describeRawEvent(PAYLOADS.SessionEnd).reason).toBe("other");
    expect(describeRawEvent(PAYLOADS.StopFailure).error).toBe("rate_limit");
    expect(describeRawEvent(PAYLOADS.PermissionDenied).reason).toMatch(/^string\(\d+\)$/);
    expect(describeRawEvent(PAYLOADS.PostToolUseFailure).error).toMatch(/^string\(\d+\)$/);
    expect(describeRawEvent(PAYLOADS.PostToolUseFailure).is_interrupt).toBe(false);
  });
});
