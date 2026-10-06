import { accessSync, chmodSync, constants, existsSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { unifiedDiff } from "./lib/diff.ts";
import { applyEnvAdditions, planEnvAdditions } from "./lib/env-file.ts";
import {
  ENV_PATH,
  RELAY_PATH,
  STATUSLINE_PATH,
  atomicWrite,
  backupSettings,
  color,
  colorDiff,
  confirm,
  fail,
  readManifest,
  readTextIfExists,
  resolveWritePath,
  settingsPathFromArgs,
  sha256Text,
  writeManifest,
} from "./lib/cli.ts";
import { SettingsFormatError, planInstall, type InstallPlan } from "./lib/settings-hooks.ts";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const allowReformat = argv.includes("--allow-reformat");
const withStatusLine = argv.includes("--with-statusline");

// Hooks run from Claude Desktop without a login shell, so the real binary path is pinned at install time.
const bunPath = realpathSync(process.execPath);
if (!isAbsolute(bunPath) || bunPath.includes("/shims/")) fail(`bun resolved to a shim (${bunPath}); run with the real binary`);
try {
  accessSync(bunPath, constants.X_OK);
} catch {
  fail(`bun binary is not executable: ${bunPath}`);
}
if (!existsSync(RELAY_PATH)) fail(`relay entrypoint not found: ${RELAY_PATH}`);

const settingsPath = settingsPathFromArgs(argv);
const writePath = resolveWritePath(settingsPath);
const originalText = readTextIfExists(writePath);
const baseText = originalText ?? "{}\n";
const { manifest } = readManifest(settingsPath);

let plan: InstallPlan;
try {
  plan = planInstall(
    baseText,
    { bunPath, relayPath: RELAY_PATH, ...(withStatusLine ? { statusLinePath: STATUSLINE_PATH } : {}) },
    // Without a manifest no container may be deleted, so a lost manifest can never cost the user a pre-existing key.
    manifest ?? { settingsPath, createdPaths: [] },
  );
} catch (err) {
  if (err instanceof SettingsFormatError) fail(err.message);
  throw err;
}

if (!plan.canonical && !allowReformat) {
  fail(
    `${settingsPath} is not in standard 2-space/4-space/tab JSON formatting, so uninstall could not restore it byte for byte.\n` +
      "  Re-run with --allow-reformat to accept a reformatted file.",
  );
}

const envText = readTextIfExists(ENV_PATH);
const envAdditions = planEnvAdditions(envText);

console.log(color.bold("Parkiran Agent: install Claude Code hooks"));
console.log(`  bun       ${bunPath}`);
console.log(`  relay     ${RELAY_PATH}`);
console.log(`  settings  ${settingsPath}${writePath !== settingsPath ? ` -> ${writePath}` : ""}`);
console.log("");

if (envAdditions.length > 0) {
  console.log(color.bold(`.env (${ENV_PATH}) will get:`));
  for (const a of envAdditions) console.log(`  ${a.key}=${a.display}`);
  console.log("");
}

if (plan.statusLineSkipped) {
  console.log(color.dim("statusLine: you already have one, leaving it untouched (plan usage stays N/A)."));
}
if (!plan.changed) {
  console.log(color.green("settings.json already contains the current Parkiran hooks."));
} else {
  console.log(colorDiff(unifiedDiff(baseText, plan.newText, settingsPath)));
  console.log("");
  if (!plan.roundTripExact) {
    console.log(color.red("! uninstall would not reproduce this file byte for byte (see README)."));
  }
}

if (dryRun) {
  console.log(color.dim("--dry-run: nothing written."));
  process.exit(0);
}
if (!plan.changed && envAdditions.length === 0) process.exit(0);

if (!confirm(plan.changed ? `Write these changes to ${settingsPath}?` : "Write the .env additions?")) {
  console.log("Aborted. Nothing written.");
  process.exit(1);
}

if (readTextIfExists(writePath) !== originalText) fail(`${settingsPath} changed while waiting for confirmation; re-run.`);

if (envAdditions.length > 0) writeFileSync(ENV_PATH, applyEnvAdditions(envText, envAdditions), { mode: 0o600 });
// The token must stay private even when .env pre-existed with a looser mode.
if (existsSync(ENV_PATH)) chmodSync(ENV_PATH, 0o600);
if (plan.changed) {
  const createdFile = originalText === null || manifest?.createdFile === true;
  // The manifest goes first: a crash between the two writes must never leave hooks installed without it.
  writeManifest({
    settingsPath,
    createdPaths: plan.createdPaths,
    createdFile,
    originalSha256: manifest?.originalSha256 ?? sha256Text(createdFile ? "" : plan.pristineText),
    installedSha256: sha256Text(plan.newText),
  });
  if (originalText !== null) console.log(color.dim(`  backup    ${backupSettings(originalText)}`));
  atomicWrite(writePath, plan.newText);
}

console.log(color.green("✓ Hooks installed. Claude Code reloads settings.json automatically; new events flow on the next hook."));
console.log(color.dim("  Remove them any time with: bun run uninstall-hooks"));
