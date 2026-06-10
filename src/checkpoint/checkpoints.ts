import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { StorePaths } from '../store/paths.js';
import { NightWatchError } from '../util/errors.js';
import { realExec } from '../util/exec.js';
import type { ExecFn } from '../util/exec.js';

/**
 * Checkpoints are commits created with git plumbing through a TEMPORARY
 * index: the user's index, worktree and HEAD are never moved. Each snapshot
 * lands under `refs/nightwatch/<session>` so `git log` stays clean and a
 * normal `git gc` keeps the objects alive while the ref exists.
 */

export const checkpointSchema = z.object({
  session: z.string(),
  seq: z.number().int().nonnegative(),
  commit: z.string().length(40),
  tree: z.string().length(40),
  ts: z.string(),
  note: z.string().optional(),
});
export type Checkpoint = z.infer<typeof checkpointSchema>;

const fileSchema = z.array(checkpointSchema);

export function listCheckpoints(paths: StorePaths, session?: string): readonly Checkpoint[] {
  if (!existsSync(paths.checkpointsFile)) return [];
  try {
    const all = fileSchema.parse(JSON.parse(readFileSync(paths.checkpointsFile, 'utf8')));
    return session ? all.filter(cp => cp.session === session) : all;
  } catch {
    return [];
  }
}

export interface CheckpointOutcome {
  readonly created: boolean;
  readonly checkpoint?: Checkpoint;
  readonly reason?: string;
}

export function createCheckpoint(
  paths: StorePaths,
  projectRoot: string,
  session: string,
  note?: string,
  exec: ExecFn = realExec,
  now: () => Date = () => new Date(),
): CheckpointOutcome {
  if (exec('git', ['rev-parse', '--is-inside-work-tree'], { cwd: projectRoot }).status !== 0) {
    return { created: false, reason: 'not a git repository' };
  }

  const tmpIndex = join(paths.root, 'tmp-index');
  const env = { GIT_INDEX_FILE: tmpIndex };
  try {
    const add = exec('git', ['add', '-A', '--', '.'], { cwd: projectRoot, env });
    if (add.status !== 0) {
      return { created: false, reason: `git add failed: ${add.stderr.trim().slice(0, 200)}` };
    }
    const writeTree = exec('git', ['write-tree'], { cwd: projectRoot, env });
    if (writeTree.status !== 0) {
      return { created: false, reason: `git write-tree failed: ${writeTree.stderr.trim().slice(0, 200)}` };
    }
    const tree = writeTree.stdout.trim();

    const existing = listCheckpoints(paths, session);
    const last = existing[existing.length - 1];
    if (last && last.tree === tree) {
      return { created: false, reason: 'no changes since last checkpoint' };
    }

    const commit = commitTree(exec, projectRoot, tree, last?.commit, note ?? `nightwatch checkpoint (${session})`);
    const checkpoint: Checkpoint = {
      session,
      seq: last ? last.seq + 1 : 0,
      commit,
      tree,
      ts: now().toISOString(),
      ...(note ? { note } : {}),
    };
    exec('git', ['update-ref', `refs/nightwatch/${sanitizeRef(session)}`, commit], { cwd: projectRoot });
    saveCheckpoint(paths, checkpoint);
    return { created: true, checkpoint };
  } finally {
    rmSync(tmpIndex, { force: true });
  }
}

function commitTree(exec: ExecFn, cwd: string, tree: string, parent: string | undefined, message: string): string {
  const env = {
    GIT_AUTHOR_NAME: 'nightwatch',
    GIT_AUTHOR_EMAIL: 'nightwatch@local',
    GIT_COMMITTER_NAME: 'nightwatch',
    GIT_COMMITTER_EMAIL: 'nightwatch@local',
  };
  const args = ['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', message];
  const result = exec('git', args, { cwd, env });
  if (result.status !== 0) {
    throw new NightWatchError('CHECKPOINT_FAILED', `git commit-tree failed: ${result.stderr.trim().slice(0, 200)}`);
  }
  return result.stdout.trim();
}

function saveCheckpoint(paths: StorePaths, checkpoint: Checkpoint): void {
  const all = [...listCheckpoints(paths), checkpoint];
  const tmp = `${paths.checkpointsFile}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(all, null, 2)}\n`, 'utf8');
  renameSync(tmp, paths.checkpointsFile);
}

function sanitizeRef(session: string): string {
  return session.replace(/[^A-Za-z0-9._-]/g, '_');
}

/** Returns the shell command a user should run to restore a checkpoint. */
export function restoreCommand(checkpoint: Checkpoint): string {
  return `git restore --source=${checkpoint.commit} --worktree -- .`;
}

/**
 * Auto-checkpoint on SessionStart as well as Stop. A single-turn headless run
 * fires Stop only once — at the very end — so without the session-start
 * baseline the scope check would diff against the END state and hide every
 * tracked-file modification. Found by the first recorded self-run.
 */
export function isAutoCheckpointEvent(hookEventName: string): boolean {
  const normalized = hookEventName.toLowerCase();
  return normalized === 'sessionstart' || normalized === 'stop';
}
