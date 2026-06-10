import type { Claim, LedgerRecord } from '../core/record.js';
import { realShellExec } from '../util/exec.js';
import type { ExecFn } from '../util/exec.js';

/**
 * "The agent says the tests passed" is the single most consequential claim in
 * a coding run, so it gets first-class verification: re-run the exact command
 * and compare. This is the replay half of "logs are claims, replays are
 * proofs" — deterministic, no model in the loop.
 */

export type TestClaimStatus = 'verified' | 'now_failing' | 'mismatch' | 'skipped' | 'error';

export interface TestClaimVerification {
  readonly seq: number;
  readonly command: string;
  readonly claimedOutcome: 'ok' | 'failed' | 'unknown';
  readonly status: TestClaimStatus;
  readonly detail: string;
}

export interface VerifyTestsOptions {
  readonly rerun: boolean;
  readonly cwd: string;
  readonly timeoutMs?: number;
  readonly exec?: ExecFn;
  /** Re-run only the last N test claims (the final state is what you ship). */
  readonly lastN?: number;
}

export function verifyTestClaims(records: readonly LedgerRecord[], options: VerifyTestsOptions): readonly TestClaimVerification[] {
  const exec = options.exec ?? realShellExec;
  const claims = collectTestClaims(records);
  const rerunFrom = options.lastN !== undefined ? Math.max(0, claims.length - options.lastN) : 0;

  return claims.map(({ seq, claim }, index) => {
    if (!options.rerun || index < rerunFrom) {
      return {
        seq,
        command: claim.command,
        claimedOutcome: claim.outcome,
        status: 'skipped',
        detail: options.rerun ? 'outside --last-n window' : 're-run disabled (pass --verify)',
      };
    }
    return rerunOne(seq, claim, options, exec);
  });
}

function rerunOne(
  seq: number,
  claim: Extract<Claim, { type: 'test_run' }>,
  options: VerifyTestsOptions,
  exec: ExecFn,
): TestClaimVerification {
  try {
    const result = exec(claim.command, [], { cwd: options.cwd, timeoutMs: options.timeoutMs ?? 300_000 });
    const passedNow = result.status === 0;
    const claimedPass = claim.outcome === 'ok';

    if (claimedPass && passedNow) {
      return { seq, command: claim.command, claimedOutcome: claim.outcome, status: 'verified', detail: 'exit 0 on re-run' };
    }
    if (claimedPass && !passedNow) {
      return {
        seq,
        command: claim.command,
        claimedOutcome: claim.outcome,
        status: 'now_failing',
        detail: `claimed pass, re-run exited ${result.status ?? 'null'}`,
      };
    }
    return {
      seq,
      command: claim.command,
      claimedOutcome: claim.outcome,
      status: passedNow ? 'mismatch' : 'verified',
      detail: passedNow ? 'claimed failure, but passes now (likely fixed later in the run)' : 'still failing, as recorded',
    };
  } catch (error) {
    return { seq, command: claim.command, claimedOutcome: claim.outcome, status: 'error', detail: String(error).slice(0, 200) };
  }
}

export function collectTestClaims(
  records: readonly LedgerRecord[],
): ReadonlyArray<{ seq: number; claim: Extract<Claim, { type: 'test_run' }> }> {
  const out: Array<{ seq: number; claim: Extract<Claim, { type: 'test_run' }> }> = [];
  for (const record of records) {
    for (const claim of record.claims ?? []) {
      if (claim.type === 'test_run') out.push({ seq: record.seq, claim });
    }
  }
  return out;
}
