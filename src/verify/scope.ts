import type { LedgerRecord } from '../core/record.js';
import type { Checkpoint } from '../checkpoint/checkpoints.js';
import { realExec } from '../util/exec.js';
import type { ExecFn } from '../util/exec.js';
import { matchesAny } from './glob.js';

/**
 * Scope verification compares three views of "what changed":
 *
 *   declared scope (meta)  —  what the agent was ALLOWED to touch
 *   ledger claims          —  what the agent SAID it touched
 *   git ground truth       —  what ACTUALLY changed on disk
 *
 * The interesting findings are the disagreements: actual changes never
 * claimed in the ledger (out-of-band writes), and changes outside the
 * declared scope (drift).
 */

export interface ScopeReport {
  readonly groundTruth: 'git' | 'unavailable';
  readonly claimedPaths: readonly string[];
  readonly actualPaths: readonly string[];
  readonly unclaimed: readonly string[];
  readonly outOfScope: readonly string[];
  readonly scopePatterns: readonly string[];
  /** 0..1 share of actual changes inside declared scope; undefined without scope or changes. */
  readonly inScopeRatio?: number;
}

export function analyzeScope(
  records: readonly LedgerRecord[],
  scopePatterns: readonly string[],
  projectRoot: string,
  firstCheckpoint?: Checkpoint,
  exec: ExecFn = realExec,
): ScopeReport {
  const claimedPaths = collectClaimedPaths(records);
  const actual = collectActualPaths(projectRoot, firstCheckpoint, exec);

  if (actual === undefined) {
    return {
      groundTruth: 'unavailable',
      claimedPaths,
      actualPaths: [],
      unclaimed: [],
      outOfScope: scopePatterns.length > 0 ? claimedPaths.filter(p => !matchesAny(p, scopePatterns)) : [],
      scopePatterns,
    };
  }

  const claimedSet = new Set(claimedPaths);
  const unclaimed = actual.filter(path => !claimedSet.has(path));
  const outOfScope = scopePatterns.length > 0 ? actual.filter(path => !matchesAny(path, scopePatterns)) : [];
  const ratio =
    scopePatterns.length > 0 && actual.length > 0 ? (actual.length - outOfScope.length) / actual.length : undefined;

  return {
    groundTruth: 'git',
    claimedPaths,
    actualPaths: actual,
    unclaimed,
    outOfScope,
    scopePatterns,
    ...(ratio !== undefined ? { inScopeRatio: ratio } : {}),
  };
}

/** Paths the ledger says were touched via structured edit tools. */
export function collectClaimedPaths(records: readonly LedgerRecord[]): readonly string[] {
  const paths = new Set<string>();
  for (const record of records) {
    for (const claim of record.claims ?? []) {
      if (claim.type === 'file_change' && claim.via.toLowerCase() !== 'bash') {
        paths.add(normalizePath(claim.path));
      }
    }
  }
  return [...paths].sort();
}

function collectActualPaths(
  projectRoot: string,
  firstCheckpoint: Checkpoint | undefined,
  exec: ExecFn,
): readonly string[] | undefined {
  if (exec('git', ['rev-parse', '--is-inside-work-tree'], { cwd: projectRoot }).status !== 0) return undefined;

  // The recorder's own store must never count as agent activity.
  const paths = new Set<string>();
  if (firstCheckpoint) {
    const diff = exec('git', ['diff', '--name-only', firstCheckpoint.commit], { cwd: projectRoot });
    if (diff.status === 0) splitLines(diff.stdout).forEach(p => paths.add(p));
  } else {
    const diff = exec('git', ['diff', '--name-only', 'HEAD'], { cwd: projectRoot });
    if (diff.status === 0) splitLines(diff.stdout).forEach(p => paths.add(p));
  }
  const untracked = exec('git', ['ls-files', '--others', '--exclude-standard'], { cwd: projectRoot });
  if (untracked.status === 0) splitLines(untracked.stdout).forEach(p => paths.add(p));

  return [...paths].filter(p => !p.startsWith('.nightwatch/')).sort();
}

function splitLines(text: string): readonly string[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

function normalizePath(path: string): string {
  return path.replace(/^\.\//, '').replace(/^\//, '');
}
