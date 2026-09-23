import { readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import type { RepoInfo } from "./sanitize.ts";

const MAX_WALK_UP = 40;
const GIT_TIMEOUT_MS = 150;
const WORKTREES_SEGMENT = `${sep}.git${sep}worktrees${sep}`;

interface GitLocation {
  workTreeRoot: string;
  gitDir: string;
  /** Main repository root when cwd is inside a linked worktree (e.g. Claude Desktop worktree sessions). */
  mainRoot: string | null;
}

function findGit(start: string): GitLocation | null {
  let dir = start;
  for (let i = 0; i < MAX_WALK_UP; i++) {
    const candidate = join(dir, ".git");
    try {
      const st = statSync(candidate);
      if (st.isDirectory()) return { workTreeRoot: dir, gitDir: candidate, mainRoot: null };
      if (st.isFile()) {
        const match = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(candidate, "utf8"));
        if (!match?.[1]) return null;
        const gitDir = resolve(dir, match[1]);
        const idx = gitDir.indexOf(WORKTREES_SEGMENT);
        return { workTreeRoot: dir, gitDir, mainRoot: idx > 0 ? gitDir.slice(0, idx) : null };
      }
    } catch {
      // not here, keep walking up
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

function branchFromHead(gitDir: string): string | null {
  try {
    const head = readFileSync(join(gitDir, "HEAD"), "utf8").trim();
    const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
    if (ref?.[1]) return ref[1] === ".invalid" ? null : ref[1];
    if (/^[0-9a-f]{40,64}$/.test(head)) return `detached@${head.slice(0, 7)}`;
  } catch {
    // fall through to the git fallback
  }
  return null;
}

function branchFromGit(gitPath: string, workTreeRoot: string): string | null {
  try {
    const proc = Bun.spawnSync([gitPath, "-C", workTreeRoot, "symbolic-ref", "--short", "-q", "HEAD"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
      timeout: GIT_TIMEOUT_MS,
    });
    if (proc.exitCode !== 0) return null;
    const out = proc.stdout.toString().trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * Project = basename of the repository root (the main repo for linked worktrees), else basename of cwd.
 * Branch comes from reading HEAD directly; `git` is only spawned for repos HEAD can't describe (reftable).
 */
export function readRepoInfo(cwd: string, gitPath: string | null): RepoInfo {
  if (!isAbsolute(cwd)) return { project: null, branch: null };
  const loc = findGit(cwd);
  if (!loc) return { project: basename(cwd) || null, branch: null };

  let branch = branchFromHead(loc.gitDir);
  if (branch === null && gitPath !== null && isAbsolute(gitPath)) branch = branchFromGit(gitPath, loc.workTreeRoot);
  return { project: basename(loc.mainRoot ?? loc.workTreeRoot) || null, branch };
}
