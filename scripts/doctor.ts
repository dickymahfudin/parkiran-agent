// Checks a Parkiran install end to end. Usage: bun scripts/doctor.ts [--settings=<path>]
// Exit code 1 only when a line says "fail"; "warn" lines are advice.
import { statSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_PORT } from "../shared/src/env.ts";
import { ENV_PATH, MANIFEST_PATH, REPO_ROOT, color, readManifest, readTextIfExists, resolveWritePath, settingsPathFromArgs } from "./lib/cli.ts";
import {
  checkEnv,
  checkHandlers,
  checkHealth,
  checkManifest,
  checkSettings,
  checkWebBuild,
  exitCode,
  formatCheck,
  resolvePort,
  type Check,
} from "./lib/doctor.ts";

const settingsPath = settingsPathFromArgs(process.argv.slice(2));
const checks: Check[] = [];

const settings = checkSettings(settingsPath, readTextIfExists(resolveWritePath(settingsPath)));
checks.push(settings.check);
if (settings.settings !== null) checks.push(...checkHandlers(settings.settings));

const envText = readTextIfExists(ENV_PATH);
const env = checkEnv(ENV_PATH, envText, envText === null ? null : statSync(ENV_PATH).mode);
checks.push(...env.checks);

checks.push(checkManifest(readManifest(settingsPath), MANIFEST_PATH));
checks.push(await checkHealth(resolvePort(process.env, env.env, DEFAULT_PORT)));
checks.push(checkWebBuild(join(REPO_ROOT, "web", "dist", "index.html")));

const paint = { ok: color.green, warn: color.cyan, fail: color.red };
console.log(color.bold("Parkiran Agent: doctor"));
for (const c of checks) console.log(paint[c.status](formatCheck(c)));
process.exit(exitCode(checks));
