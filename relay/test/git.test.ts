import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRepoInfo } from "../src/git.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "parkiran-git-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function makeRepo(name: string, head: string): string {
  const dir = join(root, name);
  mkdirSync(join(dir, ".git"), { recursive: true });
  writeFileSync(join(dir, ".git", "HEAD"), `${head}\n`);
  return dir;
}

describe("readRepoInfo", () => {
  test("branch from HEAD, project from repo root even in a subdirectory", () => {
    const repo = makeRepo("warung-app", "ref: refs/heads/feature/korek");
    const sub = join(repo, "packages", "web");
    mkdirSync(sub, { recursive: true });
    expect(readRepoInfo(sub, null)).toEqual({ project: "warung-app", branch: "feature/korek" });
  });

  test("detached HEAD shows a short sha", () => {
    const repo = makeRepo("detached", "0123456789abcdef0123456789abcdef01234567");
    expect(readRepoInfo(repo, null)).toEqual({ project: "detached", branch: "detached@0123456" });
  });

  test("linked worktree reports the main repository name", () => {
    const main = makeRepo("main-repo", "ref: refs/heads/main");
    const wtGit = join(main, ".git", "worktrees", "gifted-hopper");
    mkdirSync(wtGit, { recursive: true });
    writeFileSync(join(wtGit, "HEAD"), "ref: refs/heads/claude/gifted-hopper\n");
    const wt = join(main, ".claude", "worktrees", "gifted-hopper");
    mkdirSync(wt, { recursive: true });
    writeFileSync(join(wt, ".git"), `gitdir: ${wtGit}\n`);
    expect(readRepoInfo(wt, null)).toEqual({ project: "main-repo", branch: "claude/gifted-hopper" });
  });

  test("reftable placeholder HEAD without git fallback yields no branch", () => {
    const repo = makeRepo("reftable", "ref: refs/heads/.invalid");
    expect(readRepoInfo(repo, null)).toEqual({ project: "reftable", branch: null });
  });

  test("non-git directory uses the cwd basename", () => {
    const dir = join(root, "plain", "notes");
    mkdirSync(dir, { recursive: true });
    expect(readRepoInfo(dir, null)).toEqual({ project: "notes", branch: null });
  });

  test("relative cwd is ignored", () => {
    expect(readRepoInfo("relative/path", null)).toEqual({ project: null, branch: null });
  });
});
