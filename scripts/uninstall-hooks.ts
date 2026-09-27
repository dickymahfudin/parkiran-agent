import { rmSync } from "node:fs";
import { unifiedDiff } from "./lib/diff.ts";
import {
  atomicWrite,
  color,
  colorDiff,
  confirm,
  fail,
  readManifest,
  readTextIfExists,
  removeManifest,
  resolveWritePath,
  settingsPathFromArgs,
} from "./lib/cli.ts";
import { SettingsFormatError, planUninstall } from "./lib/settings-hooks.ts";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");

const settingsPath = settingsPathFromArgs(argv);
const writePath = resolveWritePath(settingsPath);
const text = readTextIfExists(writePath);
if (text === null) fail(`${settingsPath} does not exist`);
const manifest = readManifest(settingsPath);

let result: { newText: string; removed: number };
try {
  result = planUninstall(text, manifest?.createdPaths ?? null);
} catch (err) {
  if (err instanceof SettingsFormatError) fail(err.message);
  throw err;
}

console.log(color.bold("Parkiran Agent: uninstall Claude Code hooks"));
console.log(`  settings  ${settingsPath}`);
if (manifest === null) console.log(color.dim("  (no install manifest found; empty hook containers we leave behind will be removed)"));
console.log("");

if (result.removed === 0) {
  console.log(color.green("No Parkiran hooks found. Nothing to do."));
  removeManifest();
  process.exit(0);
}

const deleteFile = manifest?.createdFile === true && result.newText.trim() === "{}";
console.log(colorDiff(unifiedDiff(text, deleteFile ? "" : result.newText, settingsPath)));
console.log("");
console.log(`${result.removed} handler(s) will be removed${deleteFile ? `, and ${settingsPath} deleted (install created it)` : ""}.`);

if (dryRun) {
  console.log(color.dim("--dry-run: nothing written."));
  process.exit(0);
}
if (!confirm(`Apply to ${settingsPath}?`)) {
  console.log("Aborted. Nothing written.");
  process.exit(1);
}
if (readTextIfExists(writePath) !== text) fail(`${settingsPath} changed while waiting for confirmation; re-run.`);

if (deleteFile) rmSync(writePath);
else atomicWrite(writePath, result.newText);
removeManifest();
console.log(color.green("✓ Parkiran hooks removed."));
