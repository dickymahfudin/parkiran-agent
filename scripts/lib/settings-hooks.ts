import { HOOK_EVENTS, SYNC_HOOK_EVENTS, type HookEventName } from "../../shared/src/events.ts";

/** Extra argv element that identifies our handlers, so uninstall finds them even if the repo moved. */
export const RELAY_MARKER = "--parkiran-relay";
const SYNC_TIMEOUT_SECONDS = 2;

export interface HookTarget {
  bunPath: string;
  relayPath: string;
  /** When set, a statusLine command is installed too (only if the user has none). */
  statusLinePath?: string;
}

export interface InstallManifest {
  settingsPath: string;
  /** Containers that did not exist before install ("hooks", "hooks.Stop", ...). Only these may be deleted on uninstall. */
  createdPaths: string[];
}

export interface TextFormat {
  indent: string;
  eol: "\n" | "\r\n";
  trailingNewline: boolean;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

export class SettingsFormatError extends Error {}

export function detectFormat(text: string): TextFormat {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const indentMatch = /\n([ \t]+)\S/.exec(text);
  return { indent: indentMatch?.[1] ?? "  ", eol, trailingNewline: text.endsWith(eol) };
}

export function serialize(value: Json, fmt: TextFormat): string {
  const body = JSON.stringify(value, null, fmt.indent);
  const withEol = fmt.eol === "\n" ? body : body.replace(/\n/g, "\r\n");
  return fmt.trailingNewline ? withEol + fmt.eol : withEol;
}

export function parseSettings(text: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new SettingsFormatError(`settings.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!isObject(parsed)) throw new SettingsFormatError("settings.json root must be a JSON object");
  return parsed;
}

/** True when re-serializing reproduces the file byte for byte, which is what makes exact uninstall possible. */
export function isCanonical(text: string): boolean {
  return serialize(parseSettings(text), detectFormat(text)) === text;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isOurHandler(handler: unknown): boolean {
  if (!isObject(handler) || handler.type !== "command") return false;
  const args = handler.args;
  if (Array.isArray(args) && args.includes(RELAY_MARKER)) return true;
  return typeof handler.command === "string" && handler.command.includes(RELAY_MARKER);
}

export function isOurStatusLine(value: unknown): boolean {
  return isObject(value) && typeof value.command === "string" && value.command.includes(RELAY_MARKER);
}

function shellQuote(arg: string): string {
  if (arg.includes("'")) throw new SettingsFormatError(`path contains a single quote, refusing to build a shell command: ${arg}`);
  return `'${arg}'`;
}

export function buildStatusLine(bunPath: string, statusLinePath: string): JsonObject {
  return { type: "command", command: `${shellQuote(bunPath)} ${shellQuote(statusLinePath)} ${RELAY_MARKER}` };
}

export function buildHandler(event: HookEventName, target: HookTarget): JsonObject {
  const handler: JsonObject = {
    type: "command",
    command: target.bunPath,
    args: [target.relayPath, RELAY_MARKER],
  };
  if (SYNC_HOOK_EVENTS.has(event)) handler.timeout = SYNC_TIMEOUT_SECONDS;
  else handler.async = true;
  return handler;
}

function hooksObject(settings: JsonObject): JsonObject | undefined {
  const hooks = settings.hooks;
  if (hooks === undefined) return undefined;
  if (!isObject(hooks)) throw new SettingsFormatError('"hooks" in settings.json is not an object');
  return hooks;
}

/** Returns a copy without our handlers. Containers left empty are removed only if we created them. */
export function removeOurHooks(
  settings: JsonObject,
  createdPaths: readonly string[] | null,
): { settings: JsonObject; removed: number } {
  const copy = structuredClone(settings);
  let removed = 0;
  if (isOurStatusLine(copy.statusLine)) {
    delete copy.statusLine;
    removed++;
  }
  const hooks = hooksObject(copy);
  if (!hooks) return { settings: copy, removed };
  const mayDelete = (path: string): boolean => createdPaths === null || createdPaths.includes(path);

  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    let removedHere = 0;
    const kept: Json[] = [];
    for (const group of groups) {
      if (!isObject(group) || !Array.isArray(group.hooks)) {
        kept.push(group);
        continue;
      }
      const handlers = group.hooks.filter((h) => !isOurHandler(h));
      const diff = group.hooks.length - handlers.length;
      if (diff === 0) {
        kept.push(group);
        continue;
      }
      removedHere += diff;
      if (handlers.length > 0) kept.push({ ...group, hooks: handlers });
    }
    if (removedHere === 0) continue;
    removed += removedHere;
    if (kept.length === 0 && mayDelete(`hooks.${event}`)) delete hooks[event];
    else hooks[event] = kept;
  }
  if (removed > 0 && Object.keys(hooks).length === 0 && mayDelete("hooks")) delete copy.hooks;
  return { settings: copy, removed };
}

export function addOurHooks(
  settings: JsonObject,
  target: HookTarget,
): { settings: JsonObject; createdPaths: string[]; statusLineSkipped: boolean } {
  const copy = structuredClone(settings);
  const createdPaths: string[] = [];
  let hooks = hooksObject(copy);
  if (!hooks) {
    hooks = {};
    copy.hooks = hooks;
    createdPaths.push("hooks");
  }
  for (const event of HOOK_EVENTS) {
    let groups = hooks[event];
    if (groups === undefined) {
      groups = [];
      hooks[event] = groups;
      createdPaths.push(`hooks.${event}`);
    }
    if (!Array.isArray(groups)) throw new SettingsFormatError(`"hooks.${event}" in settings.json is not an array`);
    groups.push({ hooks: [buildHandler(event, target)] });
  }
  let statusLineSkipped = false;
  if (target.statusLinePath !== undefined) {
    if (copy.statusLine === undefined) {
      copy.statusLine = buildStatusLine(target.bunPath, target.statusLinePath);
      createdPaths.push("statusLine");
    } else {
      statusLineSkipped = true;
    }
  }
  return { settings: copy, createdPaths, statusLineSkipped };
}

export interface InstallPlan {
  newText: string;
  createdPaths: string[];
  canonical: boolean;
  /** uninstall(newText) reproduces the pre-install text exactly. */
  roundTripExact: boolean;
  changed: boolean;
  /** The user already has their own statusLine; we never replace it. */
  statusLineSkipped: boolean;
}

export function planInstall(text: string, target: HookTarget, previous: InstallManifest | null): InstallPlan {
  const fmt = detectFormat(text);
  const original = parseSettings(text);
  const canonical = serialize(original, fmt) === text;
  const previousCreated = previous?.createdPaths ?? null;
  const pristine = removeOurHooks(original, previousCreated);
  const pristineText = pristine.removed === 0 ? text : serialize(pristine.settings, fmt);
  const installed = addOurHooks(pristine.settings, target);
  const newText = serialize(installed.settings, fmt);
  const roundTripExact = planUninstall(newText, installed.createdPaths).newText === pristineText;
  return {
    newText,
    createdPaths: installed.createdPaths,
    canonical,
    roundTripExact,
    changed: newText !== text,
    statusLineSkipped: installed.statusLineSkipped,
  };
}

export function planUninstall(text: string, createdPaths: readonly string[] | null): { newText: string; removed: number } {
  const fmt = detectFormat(text);
  const result = removeOurHooks(parseSettings(text), createdPaths);
  return { newText: result.removed === 0 ? text : serialize(result.settings, fmt), removed: result.removed };
}
