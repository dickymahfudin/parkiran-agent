import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HOOK_EVENTS } from "../../shared/src/events.ts";
import { unifiedDiff } from "../lib/diff.ts";
import {
  RELAY_MARKER,
  SettingsFormatError,
  isOurHandler,
  parseSettings,
  planInstall,
  planUninstall,
  type HookTarget,
} from "../lib/settings-hooks.ts";

const target: HookTarget = {
  bunPath: "/Users/example/.asdf/installs/bun/1.4.0/bin/bun",
  relayPath: "/Users/example/dev/parkiran-agent/relay/src/index.ts",
};
const fixture = (name: string): string => readFileSync(join(import.meta.dir, "fixtures", name), "utf8");
const CANONICAL = [
  "user-like.json",
  "empty-object.json",
  "no-hooks.json",
  "four-space-empty-stop.json",
  "tabs-no-trailing-newline.json",
];

function ourGroups(text: string): Record<string, unknown[]> {
  const hooks = (parseSettings(text).hooks ?? {}) as Record<string, { hooks: unknown[] }[]>;
  return Object.fromEntries(
    Object.entries(hooks).map(([event, groups]) => [event, groups.flatMap((g) => g.hooks.filter(isOurHandler))]),
  );
}

describe("install + uninstall round trip", () => {
  for (const name of CANONICAL) {
    test(`${name}: uninstall restores the original bytes`, () => {
      const original = fixture(name);
      const plan = planInstall(original, target, null);
      expect(plan.canonical).toBe(true);
      expect(plan.roundTripExact).toBe(true);
      expect(plan.changed).toBe(true);
      const restored = planUninstall(plan.newText, plan.createdPaths).newText;
      expect(Buffer.from(restored).equals(Buffer.from(original))).toBe(true);
    });

    test(`${name}: installs one handler per event and keeps every existing key`, () => {
      const original = fixture(name);
      const plan = planInstall(original, target, null);
      const groups = ourGroups(plan.newText);
      for (const event of HOOK_EVENTS) expect(groups[event]).toHaveLength(1);

      const before = parseSettings(original);
      const after = parseSettings(plan.newText);
      for (const [key, value] of Object.entries(before)) {
        if (key !== "hooks") expect(after[key]).toEqual(value);
      }
      const beforeHooks = (before.hooks ?? {}) as Record<string, unknown[]>;
      const afterHooks = after.hooks as Record<string, unknown[]>;
      for (const [event, list] of Object.entries(beforeHooks)) {
        expect(afterHooks[event]!.slice(0, list.length)).toEqual(list);
      }
    });

    test(`${name}: re-install is idempotent`, () => {
      const first = planInstall(fixture(name), target, null);
      const manifest = { settingsPath: "x", createdPaths: first.createdPaths };
      const second = planInstall(first.newText, target, manifest);
      expect(second.changed).toBe(false);
      expect(second.createdPaths).toEqual(first.createdPaths);
    });
  }

  test("existing empty arrays survive uninstall when the manifest says they pre-existed", () => {
    const original = fixture("four-space-empty-stop.json");
    const plan = planInstall(original, target, null);
    expect(plan.createdPaths).not.toContain("hooks.Stop");
    expect(plan.createdPaths).not.toContain("hooks");
    expect(planUninstall(plan.newText, plan.createdPaths).newText).toBe(original);
  });

  test("uninstall without a manifest still removes our entries and empty containers we left", () => {
    const original = fixture("no-hooks.json");
    const plan = planInstall(original, target, null);
    expect(planUninstall(plan.newText, null).newText).toBe(original);
  });

  test("re-install after the repo moved replaces the old handlers", () => {
    const first = planInstall(fixture("user-like.json"), target, null);
    const moved = planInstall(first.newText, { ...target, relayPath: "/new/place/relay/src/index.ts" }, {
      settingsPath: "x",
      createdPaths: first.createdPaths,
    });
    const groups = ourGroups(moved.newText);
    for (const event of HOOK_EVENTS) {
      expect(groups[event]).toHaveLength(1);
      expect((groups[event]![0] as { args: string[] }).args[0]).toBe("/new/place/relay/src/index.ts");
    }
  });

  test("a handler the user added into our group is kept on uninstall", () => {
    const plan = planInstall(fixture("no-hooks.json"), target, null);
    const settings = parseSettings(plan.newText) as { hooks: Record<string, { hooks: unknown[] }[]> };
    const mine = { type: "command", command: "echo mine" };
    settings.hooks.Stop![0]!.hooks.push(mine);
    const edited = `${JSON.stringify(settings, null, 2)}\n`;
    const result = parseSettings(planUninstall(edited, plan.createdPaths).newText) as typeof settings;
    expect(result.hooks.Stop).toEqual([{ hooks: [mine] }]);
    expect(Object.keys(result.hooks)).toEqual(["Stop"]);
  });

  test("non-canonical files are detected so the CLI can refuse to reformat them", () => {
    const plan = planInstall(fixture("compact-non-canonical.json"), target, null);
    expect(plan.canonical).toBe(false);
  });
});

describe("statusLine experiment", () => {
  const withStatus: HookTarget = { ...target, statusLinePath: "/Users/example/dev/parkiran-agent/relay/src/statusline.ts" };

  for (const name of CANONICAL) {
    test(`${name}: adds our statusLine and uninstall restores the bytes`, () => {
      const original = fixture(name);
      const plan = planInstall(original, withStatus, null);
      expect(plan.statusLineSkipped).toBe(false);
      expect(plan.createdPaths).toContain("statusLine");
      const settings = parseSettings(plan.newText) as { statusLine: { type: string; command: string } };
      expect(settings.statusLine).toEqual({
        type: "command",
        command: `'${target.bunPath}' '${withStatus.statusLinePath}' ${RELAY_MARKER}`,
      });
      expect(planUninstall(plan.newText, plan.createdPaths).newText).toBe(original);
    });
  }

  test("an existing user statusLine is never replaced or removed", () => {
    const original = `${JSON.stringify({ statusLine: { type: "command", command: "~/.claude/mine.sh" } }, null, 2)}\n`;
    const plan = planInstall(original, withStatus, null);
    expect(plan.statusLineSkipped).toBe(true);
    expect((parseSettings(plan.newText).statusLine as { command: string }).command).toBe("~/.claude/mine.sh");
    expect(planUninstall(plan.newText, plan.createdPaths).newText).toBe(original);
  });

  test("re-install without the flag removes only our statusLine", () => {
    const first = planInstall(fixture("no-hooks.json"), withStatus, null);
    const second = planInstall(first.newText, target, { settingsPath: "x", createdPaths: first.createdPaths });
    expect(parseSettings(second.newText).statusLine).toBeUndefined();
    expect(Object.keys(ourGroups(second.newText))).toHaveLength(HOOK_EVENTS.length);
  });

  test("paths with a single quote are refused", () => {
    expect(() => planInstall("{}\n", { ...target, statusLinePath: "/tmp/it's/statusline.ts" }, null)).toThrow(SettingsFormatError);
  });
});

describe("handler shape", () => {
  test("exec form, async everywhere except SessionEnd", () => {
    const groups = ourGroups(planInstall("{}\n", target, null).newText);
    for (const event of HOOK_EVENTS) {
      const handler = groups[event]![0] as Record<string, unknown>;
      expect(handler.command).toBe(target.bunPath);
      expect(handler.args).toEqual([target.relayPath, RELAY_MARKER]);
      if (event === "SessionEnd") {
        expect(handler.async).toBeUndefined();
        expect(handler.timeout).toBe(2);
      } else {
        expect(handler.async).toBe(true);
      }
    }
  });

  test("matcher is omitted so every occurrence matches", () => {
    const settings = parseSettings(planInstall("{}\n", target, null).newText) as {
      hooks: Record<string, Record<string, unknown>[]>;
    };
    for (const event of HOOK_EVENTS) expect(settings.hooks[event]![0]!.matcher).toBeUndefined();
  });
});

describe("errors", () => {
  test("invalid JSON and unexpected shapes fail loudly", () => {
    expect(() => planInstall("{ nope", target, null)).toThrow(SettingsFormatError);
    expect(() => planInstall("[]\n", target, null)).toThrow(SettingsFormatError);
    expect(() => planInstall('{\n  "hooks": []\n}\n', target, null)).toThrow(SettingsFormatError);
    expect(() => planInstall('{\n  "hooks": {\n    "Stop": {}\n  }\n}\n', target, null)).toThrow(SettingsFormatError);
  });
});

describe("unifiedDiff", () => {
  test("an install only adds lines, apart from trailing commas and expanded empty containers", () => {
    for (const name of CANONICAL) {
      const original = fixture(name);
      const diff = unifiedDiff(original, planInstall(original, target, null).newText, "settings.json");
      const body = diff.split("\n").slice(2);
      const added = new Set(body.filter((l) => l.startsWith("+")).map((l) => l.slice(1)));
      for (const removed of body.filter((l) => l.startsWith("-")).map((l) => l.slice(1))) {
        const emptyContainer = /(\{\}|\[\]),?$/.test(removed.trimEnd());
        expect(added.has(`${removed},`) || emptyContainer).toBe(true);
      }
      expect(added.size).toBeGreaterThan(HOOK_EVENTS.length);
    }
  });
});
