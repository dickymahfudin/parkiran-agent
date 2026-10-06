import { rmSync } from "node:fs";
import { unifiedDiff } from "./lib/diff.ts";
import {
  atomicWrite,
  backupSettings,
  color,
  colorDiff,
  confirm,
  fail,
  readManifest,
  readTextIfExists,
  removeManifest,
  resolveWritePath,
  settingsPathFromArgs,
  sha256Text,
} from "./lib/cli.ts";
import { SettingsFormatError, planUninstall } from "./lib/settings-hooks.ts";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");

const settingsPath = settingsPathFromArgs(argv);
const writePath = resolveWritePath(settingsPath);
const text = readTextIfExists(writePath);
if (text === null) fail(`${settingsPath} does not exist`);
const { manifest, problem } = readManifest(settingsPath);

let result: { newText: string; removed: number };
try {
  // No manifest means no proof of what we created, so no container is deleted: only our handlers go.
  result = planUninstall(text, manifest?.createdPaths ?? []);
} catch (err) {
  if (err instanceof SettingsFormatError) fail(err.message);
  throw err;
}

console.log(color.bold("Parkiran Agent: uninstall Claude Code hooks"));
console.log(`  settings  ${settingsPath}`);
if (manifest === null) {
  console.log(color.red(`! ${problem ?? "no install manifest"}`));
  console.log(color.red("  Only Parkiran's handlers will be removed; hook containers (even empty ones) are left in place."));
}
console.log("");

if (result.removed === 0) {
  console.log(color.green("No Parkiran hooks found. Nothing to do."));
  removeManifest();
  process.exit(0);
}

const deleteFile = manifest?.createdFile === true && result.newText.trim() === "{}";
console.log(colorDiff(unifiedDiff(text, deleteFile ? "" : result.newText, settingsPath)));
console.log("");
if (manifest?.installedSha256 !== undefined && sha256Text(text) !== manifest.installedSha256) {
  console.log(color.red(`! ${settingsPath} was changed after install-hooks wrote it; only Parkiran's handlers are removed.`));
}
if (manifest?.originalSha256 !== undefined && sha256Text(deleteFile ? "" : result.newText) !== manifest.originalSha256) {
  console.log(color.red("! the result will not be byte-identical to the pre-install file (a backup is written first)."));
}
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

console.log(color.dim(`  backup    ${backupSettings(text)}`));
if (deleteFile) rmSync(writePath);
else atomicWrite(writePath, result.newText);
removeManifest();
console.log(color.green("✓ Parkiran hooks removed."));
