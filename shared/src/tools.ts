/** What the character does on the laptop while a tool runs. */
export type WorkKind = "think" | "read" | "bash" | "edit" | "web" | "agent" | "other";

const KINDS: Record<string, WorkKind> = {
  Read: "read",
  Glob: "read",
  Grep: "read",
  LS: "read",
  NotebookRead: "read",
  Bash: "bash",
  BashOutput: "bash",
  KillShell: "bash",
  PowerShell: "bash",
  Monitor: "bash",
  Edit: "edit",
  MultiEdit: "edit",
  Write: "edit",
  NotebookEdit: "edit",
  WebFetch: "web",
  WebSearch: "web",
  Agent: "agent",
  Task: "agent",
  Workflow: "agent",
};

/** Tools that put the session in "needs me" until answered. */
export const QUESTION_TOOLS: ReadonlySet<string> = new Set(["AskUserQuestion", "ExitPlanMode"]);

/** How tool calls are counted for a session's tool mix: the work kinds, with MCP tools on their own. */
export type ToolGroup = Exclude<WorkKind, "think"> | "mcp";

export function toolGroupOf(toolName: string | undefined): ToolGroup {
  if (toolName?.startsWith("mcp__")) return "mcp";
  const kind = workKindOf(toolName);
  return kind === "think" ? "other" : kind;
}

export function workKindOf(toolName: string | undefined): WorkKind {
  if (toolName === undefined) return "think";
  return KINDS[toolName] ?? "other";
}
