import { readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const BACKUP_PREFIX = "settings.json.";
export const BACKUP_SUFFIX = ".bak";
export const MAX_BACKUPS = 10;

/** `settings.json.2026-10-10T08-30-00.000Z.bak`: ISO timestamp with ':' replaced so it is a safe file name. */
export function backupName(now: Date): string {
  return `${BACKUP_PREFIX}${now.toISOString().replace(/:/g, "-")}${BACKUP_SUFFIX}`;
}

export function isBackupName(name: string): boolean {
  return name.startsWith(BACKUP_PREFIX) && name.endsWith(BACKUP_SUFFIX) && name.length > BACKUP_PREFIX.length + BACKUP_SUFFIX.length;
}

/** Backup names sorted oldest first (ISO timestamps sort lexically). */
export function listBackups(dir: string): string[] {
  return readdirSync(dir).filter(isBackupName).sort();
}

/** Returns the names that must go so at most `keep` remain. */
export function backupsToPrune(names: readonly string[], keep: number): string[] {
  const sorted = [...names].sort();
  return sorted.slice(0, Math.max(0, sorted.length - keep));
}

/** Copies `text` into a fresh 0600 backup under `dir` and keeps only the newest MAX_BACKUPS. Returns the backup path. */
export function writeBackup(dir: string, text: string, now = new Date()): string {
  const path = join(dir, backupName(now));
  writeFileSync(path, text, { mode: 0o600, flag: "wx" });
  for (const old of backupsToPrune(listBackups(dir), MAX_BACKUPS)) rmSync(join(dir, old), { force: true });
  return path;
}
