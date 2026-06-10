import type { LedgerRecord } from '../core/record.js';
import { verifyLedgerSignatures } from '../core/signing.js';
import type { LedgerHead } from '../store/ledger.js';
import { verifyChain } from '../store/ledger.js';
import { matchesAny } from '../verify/glob.js';
import { collectClaimedPaths } from '../verify/scope.js';

/**
 * attest = the CI gate. Given a run ledger (the "receipt") and the set of
 * files a PR actually changes, decide whether the receipt vouches for the
 * change: intact chain, valid signatures, and — the core check — every
 * changed file backed by a ledger claim. "No receipt, no review."
 *
 * Pure function: all I/O (reading ledgers, git diffs, key files) happens in
 * the CLI layer, which keeps every policy decision here unit-testable.
 */

export type AttestSeverity = 'error' | 'warning' | 'info';

export interface AttestFinding {
  readonly code:
    | 'EMPTY_LEDGER'
    | 'CHAIN_BROKEN'
    | 'TRUNCATED'
    | 'SIG_INVALID'
    | 'NO_SIGNED_RECORDS'
    | 'UNSIGNED_RECORDS'
    | 'UNDECLARED_CHANGE'
    | 'OUT_OF_SCOPE'
    | 'CLAIMED_NOT_CHANGED'
    | 'LAST_TEST_CLAIM_FAILED';
  readonly severity: AttestSeverity;
  readonly message: string;
}

export interface AttestSummary {
  readonly records: number;
  readonly chainOk: boolean;
  readonly signed: number;
  readonly invalidSignatures: number;
  readonly changedFiles: number;
  readonly claimedFiles: number;
  readonly undeclared: readonly string[];
  readonly outOfScope: readonly string[];
}

export interface AttestVerdict {
  /** True when no error-severity findings exist (warnings pass unless strict). */
  readonly ok: boolean;
  readonly findings: readonly AttestFinding[];
  readonly summary: AttestSummary;
}

export interface AttestInput {
  readonly records: readonly LedgerRecord[];
  readonly head?: LedgerHead;
  readonly publicKeyPem?: string;
  /** Repo-relative paths the PR/worktree actually changes; omit to skip the diff gate. */
  readonly changedFiles?: readonly string[];
  readonly scopePatterns?: readonly string[];
  /** Absolute project root used to relativize claimed paths. */
  readonly projectRoot?: string;
  /** Paths exempt from the undeclared-change gate (the receipt itself, etc.). */
  readonly exemptPaths?: readonly string[];
  /** Treat warnings as failures. */
  readonly strict?: boolean;
}

export function attest(input: AttestInput): AttestVerdict {
  const findings: AttestFinding[] = [];

  findings.push(...chainFindings(input));
  findings.push(...signatureFindings(input));
  const { undeclared, outOfScope, claimed, changed } = diffFindings(input, findings);
  findings.push(...testClaimFindings(input.records));

  const failing: AttestSeverity[] = input.strict ? ['error', 'warning'] : ['error'];
  const ok = !findings.some(finding => failing.includes(finding.severity));

  const signatures =
    input.publicKeyPem !== undefined ? verifyLedgerSignatures(input.records, input.publicKeyPem) : undefined;

  return {
    ok,
    findings,
    summary: {
      records: input.records.length,
      chainOk: verifyChain(input.records, input.head).ok,
      signed: signatures?.signed ?? 0,
      invalidSignatures: signatures?.invalidSeqs.length ?? 0,
      changedFiles: changed.length,
      claimedFiles: claimed.length,
      undeclared,
      outOfScope,
    },
  };
}

function chainFindings(input: AttestInput): AttestFinding[] {
  if (input.records.length === 0) {
    return [{ code: 'EMPTY_LEDGER', severity: 'error', message: 'ledger contains no records — nothing to attest' }];
  }
  const chain = verifyChain(input.records, input.head);
  if (chain.ok) return [];
  if (chain.truncated) {
    return [{ code: 'TRUNCATED', severity: 'error', message: `ledger truncated: ${chain.reason ?? 'head sidecar past file end'}` }];
  }
  return [
    {
      code: 'CHAIN_BROKEN',
      severity: 'error',
      message: `hash chain broken at seq ${chain.brokenAtSeq ?? '?'}: ${chain.reason ?? 'unknown'}`,
    },
  ];
}

function signatureFindings(input: AttestInput): AttestFinding[] {
  if (input.publicKeyPem === undefined) return [];
  const check = verifyLedgerSignatures(input.records, input.publicKeyPem);
  const findings: AttestFinding[] = [];
  for (const seq of check.invalidSeqs) {
    findings.push({ code: 'SIG_INVALID', severity: 'error', message: `record seq ${seq} has an invalid signature` });
  }
  if (check.signed === 0 && input.records.length > 0) {
    findings.push({
      code: 'NO_SIGNED_RECORDS',
      severity: 'warning',
      message: 'a public key is configured but no record is signed',
    });
  } else if (check.unsigned > 0) {
    findings.push({
      code: 'UNSIGNED_RECORDS',
      severity: 'warning',
      message: `${check.unsigned} record(s) are unsigned (they may predate the key)`,
    });
  }
  return findings;
}

function diffFindings(
  input: AttestInput,
  findings: AttestFinding[],
): { undeclared: readonly string[]; outOfScope: readonly string[]; claimed: readonly string[]; changed: readonly string[] } {
  const claimed = collectClaimedPaths(input.records, input.projectRoot);
  if (input.changedFiles === undefined) {
    return { undeclared: [], outOfScope: [], claimed, changed: [] };
  }

  const exempt = new Set((input.exemptPaths ?? []).map(normalize));
  const changed = input.changedFiles
    .map(normalize)
    .filter(path => path.length > 0 && !path.startsWith('.nightwatch/') && !exempt.has(path));
  const claimedSet = new Set(claimed);

  const undeclared = changed.filter(path => !claimedSet.has(path)).sort();
  for (const path of undeclared) {
    findings.push({
      code: 'UNDECLARED_CHANGE',
      severity: 'error',
      message: `changed but never claimed in the ledger: ${path}`,
    });
  }

  const scope = input.scopePatterns ?? [];
  const outOfScope = scope.length > 0 ? changed.filter(path => !matchesAny(path, scope)).sort() : [];
  for (const path of outOfScope) {
    findings.push({ code: 'OUT_OF_SCOPE', severity: 'error', message: `outside declared scope: ${path}` });
  }

  const changedSet = new Set(changed);
  for (const path of claimed.filter(p => !changedSet.has(p)).sort()) {
    findings.push({
      code: 'CLAIMED_NOT_CHANGED',
      severity: 'info',
      message: `claimed in the ledger but not part of this change set: ${path}`,
    });
  }
  return { undeclared, outOfScope, claimed, changed };
}

/** Only the FINAL recorded test outcome matters — earlier failures are TDD red phases. */
function testClaimFindings(records: readonly LedgerRecord[]): AttestFinding[] {
  let last: { outcome: string; command: string } | undefined;
  for (const record of records) {
    for (const claim of record.claims ?? []) {
      if (claim.type === 'test_run') last = { outcome: claim.outcome, command: claim.command };
    }
  }
  if (last && last.outcome === 'failed') {
    return [
      {
        code: 'LAST_TEST_CLAIM_FAILED',
        severity: 'warning',
        message: `the last recorded test run was failing: ${last.command.slice(0, 120)}`,
      },
    ];
  }
  return [];
}

function normalize(path: string): string {
  return path.replace(/^\.\//, '').trim();
}
