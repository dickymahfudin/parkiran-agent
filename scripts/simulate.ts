// Drives the server with scripted, realistic sessions (no real Claude needed).
// Usage: bun run simulate -- --port=4757 [--scenario=tour|<name>] [--speed=1] [--loop] [--fresh] [--list]
// The port must be given, and it refuses the port in .env (the live lot with your real sessions) unless --live is passed.
// Doze needs a short idle timeout on the server: PARKIRAN_IDLE_MINUTES=0.3 PARKIRAN_PORT=4757 bun run server
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DEFAULT_PORT, parseEnvFile } from "../shared/src/env.ts";
import type { HookEventName, IngestEvent } from "../shared/src/events.ts";

const REPO_ROOT = resolve(import.meta.dir, "..");
const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k ?? "", v ?? "true"] as const;
  }),
);
const speed = Number(args.get("speed") ?? 1);
const loop = args.has("loop");
const fresh = args.has("fresh");
if (!Number.isFinite(speed) || speed <= 0) {
  console.error(`--speed must be a positive number, got "${args.get("speed")}"`);
  process.exit(1);
}

// A fresh clone has no .env until `bun run install-hooks`: --list and the port checks work without it; only sending
// events needs the token (checked right before the run).
const envPath = join(REPO_ROOT, ".env");
const env = existsSync(envPath) ? parseEnvFile(readFileSync(envPath, "utf8")) : {};
const token = process.env.PARKIRAN_TOKEN ?? env.PARKIRAN_TOKEN;

/** The port the hooks post to: the live lot. Simulated sessions there sit next to your real ones for hours. */
const livePort = Number(env.PARKIRAN_PORT ?? DEFAULT_PORT);
const portArg = args.get("port") ?? process.env.PARKIRAN_SIM_PORT;
const port = Number(portArg);
if (!args.has("list")) {
  if (portArg === undefined || !Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`--port=<test server port> is required (e.g. --port=4757; the live lot is on ${livePort})`);
    process.exit(1);
  }
  if (port === livePort && !args.has("live")) {
    console.error(`refusing to simulate against the live lot on 127.0.0.1:${port} (PARKIRAN_PORT in .env); pass --live if you mean it`);
    process.exit(1);
  }
}

const sleep = (ms: number) => Bun.sleep(Math.max(0, ms / speed));
const jitter = (ms: number) => ms * (0.75 + Math.random() * 0.5);

/** Stable fake session id per actor name so the same scenario always shows the same characters. */
function sessionIdFor(name: string): string {
  const hex = new Bun.CryptoHasher("sha256").update(fresh ? `${name}-${Math.random()}` : name).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

let toolSeq = 0;
const newToolId = () => `toolu_sim${(++toolSeq).toString(36).padStart(8, "0")}`;

class Actor {
  readonly sessionId: string;
  constructor(
    readonly name: string,
    readonly project: string,
    readonly branch: string,
  ) {
    this.sessionId = sessionIdFor(name);
  }

  async emit(event: HookEventName, extra: Partial<IngestEvent> = {}): Promise<void> {
    const body: IngestEvent = { v: 1, event, sessionId: this.sessionId, ts: Date.now(), project: this.project, branch: this.branch, ...extra };
    const label = [extra.toolName, extra.notificationType, extra.agentType].filter(Boolean).join(" ");
    console.log(`${new Date().toISOString().slice(11, 23)} ${this.name.padEnd(10)} ${event}${label ? ` (${label})` : ""}`);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-parkiran-token": token! },
        body: JSON.stringify(body),
      });
      if (res.status !== 204) console.error(`  server answered ${res.status}: ${await res.text()}`);
    } catch (err) {
      console.error(`  cannot reach the server on 127.0.0.1:${port} (${err instanceof Error ? err.message : err})`);
    }
  }

  start = () => this.emit("SessionStart", { source: "startup" });
  prompt = () => this.emit("UserPromptSubmit");
  stop = () => this.emit("Stop");
  end = () => this.emit("SessionEnd", { endReason: "other" });

  async tool(toolName: string, ms: number, opts: { fail?: boolean; agentId?: string; agentType?: string } = {}): Promise<void> {
    const toolUseId = newToolId();
    const agent = opts.agentId ? { agentId: opts.agentId, agentType: opts.agentType ?? "general-purpose" } : {};
    await this.emit("PreToolUse", { toolName, toolUseId, ...agent });
    await sleep(jitter(ms));
    if (opts.fail) await this.emit("PostToolUseFailure", { toolName, toolUseId, isInterrupt: false, ...agent });
    else await this.emit("PostToolUse", { toolName, toolUseId, ...agent });
    await sleep(jitter(400));
  }

  async work(cycles: number): Promise<void> {
    const tools: [string, number][] = [
      ["Read", 600],
      ["Grep", 500],
      ["Glob", 300],
      ["Edit", 1200],
      ["Bash", 3500],
      ["Read", 700],
      ["Write", 900],
    ];
    for (let i = 0; i < cycles; i++) {
      const [name, ms] = tools[Math.floor(Math.random() * tools.length)]!;
      await this.tool(name, ms);
    }
  }

  /** Permission dialog: approved → the tool runs; denied → no event at all, then the human types (measured). */
  async permission(toolName: string, decision: "approve" | "deny", waitMs: number): Promise<void> {
    const toolUseId = newToolId();
    await this.emit("PreToolUse", { toolName, toolUseId });
    await sleep(120);
    await this.emit("PermissionRequest", { toolName });
    if (waitMs > 6000) {
      await sleep(6000);
      await this.emit("Notification", { notificationType: "permission_prompt" });
      await sleep(waitMs - 6000);
    } else await sleep(waitMs);
    if (decision === "approve") {
      await sleep(200);
      await this.emit("PostToolUse", { toolName, toolUseId });
    } else {
      await sleep(4000);
      await this.prompt();
    }
  }

  async question(waitMs: number): Promise<void> {
    const toolUseId = newToolId();
    await this.emit("PreToolUse", { toolName: "AskUserQuestion", toolUseId });
    await sleep(waitMs);
    await this.emit("PostToolUse", { toolName: "AskUserQuestion", toolUseId });
  }

  async compact(ms: number): Promise<void> {
    await this.emit("PreCompact", { compactTrigger: "auto" });
    await sleep(ms);
    await this.emit("PostCompact", { compactTrigger: "auto" });
    await this.emit("SessionStart", { source: "compact" });
  }

  async subagents(types: string[], toolsEach: number): Promise<void> {
    const parentTool = newToolId();
    await this.emit("PreToolUse", { toolName: "Agent", toolUseId: parentTool });
    const ids = types.map((t, i) => ({
      agentId: `a${sessionIdFor(this.name + i)
        .replace(/-/g, "")
        .slice(0, 16)}`,
      agentType: t,
    }));
    for (const a of ids) {
      await this.emit("SubagentStart", a);
      await sleep(800);
    }
    await Promise.all(
      ids.map(async (a) => {
        for (let i = 0; i < toolsEach; i++) await this.tool(i % 2 ? "Grep" : "Read", 900, a);
        await this.emit("SubagentStop", a);
      }),
    );
    await this.emit("PostToolUse", { toolName: "Agent", toolUseId: parentTool });
  }
}

type Scenario = { description: string; run: () => Promise<void> };

const scenarios: Record<string, Scenario> = {
  working: {
    description: "one session typing through read / bash / edit tools",
    async run() {
      const a = new Actor("rina", "warung-app", "main");
      await a.start();
      await a.prompt();
      await a.work(12);
      await a.stop();
    },
  },
  approve: {
    description: "needs korek, permission approved after 8 s (lighter handed over)",
    async run() {
      const a = new Actor("budi", "toko-online", "feature/cart");
      await a.start();
      await a.prompt();
      await a.work(2);
      await a.permission("Bash", "approve", 8000);
      await a.work(3);
      await a.stop();
    },
  },
  deny: {
    description: "needs korek, permission denied (no event), user types again",
    async run() {
      const a = new Actor("sari", "parkiran-agent", "main");
      await a.start();
      await a.prompt();
      await a.work(2);
      await a.permission("Bash", "deny", 7000);
      await a.work(2);
      await a.stop();
    },
  },
  question: {
    description: "AskUserQuestion answered after 10 s, then an MCP elicitation answered after 6 s",
    async run() {
      const a = new Actor("dewi", "blog", "draft");
      await a.start();
      await a.prompt();
      await a.work(1);
      await a.question(10_000);
      await a.work(1);
      await a.emit("Elicitation");
      await sleep(6000);
      await a.emit("ElicitationResult");
      await a.work(1);
      await a.stop();
    },
  },
  failure: {
    description: "tool failure, then an API error ends the turn",
    async run() {
      const a = new Actor("agus", "api-gateway", "develop");
      await a.start();
      await a.prompt();
      await a.tool("Bash", 2500, { fail: true });
      await a.work(2);
      await a.emit("StopFailure", { stopError: "overloaded" });
    },
  },
  compact: {
    description: "auto compaction mid-turn: walks to the warung for kopi",
    async run() {
      const a = new Actor("joko", "dotfiles", "master");
      await a.start();
      await a.prompt();
      await a.work(2);
      await a.compact(9000);
      await a.work(2);
      await a.stop();
    },
  },
  subagent: {
    description: "two subagent friends join, work, and leave",
    async run() {
      const a = new Actor("tono", "parkiran-agent", "feat/scene");
      await a.start();
      await a.prompt();
      await a.subagents(["Explore", "Plan"], 4);
      await a.work(1);
      await a.stop();
    },
  },
  idle: {
    description: "finishes a turn and stays idle (smoke, kopi, stretch, chat)",
    async run() {
      const a = new Actor("rina", "warung-app", "main");
      await a.start();
      await a.prompt();
      await a.work(2);
      await a.stop();
      await sleep(60_000);
      await a.emit("Notification", { notificationType: "idle_prompt" });
    },
  },
  end: {
    description: "session ends: stubs out, closes laptop, walks away",
    async run() {
      const a = new Actor("wati", "notes", "main");
      await a.start();
      await a.prompt();
      await a.work(2);
      await a.stop();
      await sleep(5000);
      await a.end();
    },
  },
  six: {
    description: "six concurrent busy sessions (performance check)",
    async run() {
      const names = ["rina", "budi", "sari", "dewi", "agus", "joko"];
      const projects = ["warung-app", "toko-online", "parkiran-agent", "blog", "api-gateway", "dotfiles"];
      await Promise.all(
        names.map(async (n, i) => {
          const a = new Actor(n, projects[i]!, "main");
          await sleep(i * 1500);
          await a.start();
          for (let r = 0; r < 4; r++) {
            await a.prompt();
            await a.work(6);
            await a.stop();
            await sleep(jitter(15_000));
          }
        }),
      );
    },
  },
};

scenarios.tour = {
  description: "six sessions covering every state at once (default)",
  async run() {
    const parts = ["working", "approve", "deny", "subagent", "compact", "failure", "question"];
    await Promise.all(
      parts.map(async (name, i) => {
        await sleep(i * 2500);
        await scenarios[name]!.run();
      }),
    );
    const doze = new Actor("wati", "notes", "main");
    await doze.start();
    await doze.prompt();
    await doze.work(1);
    await doze.stop();
    console.log("idle sessions doze after PARKIRAN_IDLE_MINUTES; ending 'wati' in 40 s");
    await sleep(40_000);
    await doze.end();
  },
};

if (args.has("list")) {
  for (const [name, s] of Object.entries(scenarios)) console.log(`${name.padEnd(10)} ${s.description}`);
  process.exit(0);
}

const name = args.get("scenario") ?? "tour";
const scenario = scenarios[name];
if (!scenario) {
  console.error(`unknown scenario "${name}". Try --list`);
  process.exit(1);
}
if (!token) {
  console.error("PARKIRAN_TOKEN missing: run `bun run install-hooks` (it creates .env) or set PARKIRAN_TOKEN");
  process.exit(1);
}
console.log(`simulating "${name}" at ${speed}x against 127.0.0.1:${port}${loop ? " (looping)" : ""}`);
do {
  await scenario.run();
} while (loop);
