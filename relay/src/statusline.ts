// statusLine probe (experiment): records whether Claude Code calls the status line and the plan-usage numbers.
// Prints nothing, so the status line stays empty. Never throws, always exits 0.
import { appendLog, describeShape } from "./rawlog.ts";

const MAX_STDIN_BYTES = 1024 * 1024;

interface UsageWindow {
  usedPercentage: number;
  resetsAt: number | null;
}

function readWindow(value: unknown): UsageWindow | null {
  if (typeof value !== "object" || value === null) return null;
  const w = value as Record<string, unknown>;
  if (typeof w.used_percentage !== "number" || !Number.isFinite(w.used_percentage)) return null;
  return {
    usedPercentage: w.used_percentage,
    resetsAt: typeof w.resets_at === "number" && Number.isFinite(w.resets_at) ? w.resets_at : null,
  };
}

export function extractUsage(raw: unknown): { fiveHour: UsageWindow | null; sevenDay: UsageWindow | null } {
  const limits = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>).rate_limits : undefined;
  const obj = typeof limits === "object" && limits !== null ? (limits as Record<string, unknown>) : {};
  return { fiveHour: readWindow(obj.five_hour), sevenDay: readWindow(obj.seven_day) };
}

async function main(): Promise<void> {
  const text = await new Response(Bun.stdin.stream()).text();
  if (text.length > MAX_STDIN_BYTES) return;
  let raw: unknown = null;
  try {
    raw = JSON.parse(text);
  } catch {
    // shape log still records that we were called
  }
  appendLog("statusline-probe.jsonl", JSON.stringify({ at: new Date().toISOString(), shape: describeShape(raw), usage: extractUsage(raw) }));
}

if (import.meta.main) {
  setTimeout(() => process.exit(0), 1000).unref();
  main()
    .catch(() => undefined)
    .finally(() => process.exit(0));
}
