import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_BACKUPS, backupName, backupsToPrune, isBackupName, listBackups, writeBackup } from "../lib/backup.ts";

const dir = mkdtempSync(join(tmpdir(), "parkiran-backup-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("settings.json backups", () => {
  test("backup name is the ISO timestamp without colons", () => {
    expect(backupName(new Date("2026-10-10T08:30:00.000Z"))).toBe("settings.json.2026-10-10T08-30-00.000Z.bak");
    expect(isBackupName("settings.json.2026-10-10T08-30-00.000Z.bak")).toBe(true);
    expect(isBackupName("settings.json.bak")).toBe(false);
    expect(isBackupName("hooks-install.json")).toBe(false);
  });

  test("prunes the oldest beyond the limit", () => {
    const names = Array.from({ length: 12 }, (_, i) => backupName(new Date(Date.UTC(2026, 0, i + 1))));
    expect(backupsToPrune(names, 10)).toEqual(names.slice(0, 2));
    expect(backupsToPrune(names.slice(0, 3), 10)).toEqual([]);
  });

  test("writeBackup stores the text with mode 0600 and keeps at most MAX_BACKUPS", () => {
    writeFileSync(join(dir, "hooks-install.json"), "{}");
    let path = "";
    for (let i = 0; i < MAX_BACKUPS + 3; i++) {
      path = writeBackup(dir, `{"i":${i}}`, new Date(Date.UTC(2026, 0, 1, 0, 0, i)));
    }
    expect(readFileSync(path, "utf8")).toBe(`{"i":${MAX_BACKUPS + 2}}`);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const kept = listBackups(dir);
    expect(kept).toHaveLength(MAX_BACKUPS);
    expect(kept[kept.length - 1]).toBe(backupName(new Date(Date.UTC(2026, 0, 1, 0, 0, MAX_BACKUPS + 2))));
    expect(existsSync(join(dir, backupName(new Date(Date.UTC(2026, 0, 1, 0, 0, 0)))))).toBe(false);
    expect(existsSync(join(dir, "hooks-install.json"))).toBe(true);
  });
});
