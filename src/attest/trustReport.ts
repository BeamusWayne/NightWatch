import type { AttestFinding, AttestVerdict } from './attest.js';

/**
 * Agent Trust Report v0 — the cross-tool verdict format of the trust layer.
 *
 * One schema, three producers: NightWatch (`attest --trust-report`) reports
 * on a recorded session, Alfred (`ledger verify --trust-report`) on a signed
 * run receipt, trace-vault (`vault gate --trust-report`) on a replay suite.
 * CI consumes the same `{verdict, checks[]}` regardless of which tool —
 * spec: https://github.com/BeamusWayne/agent-trust-layer
 */

export type TrustVerdict = 'pass' | 'warn' | 'fail';

export interface TrustCheck {
  /** Stable dotted id, e.g. `ledger.chain`, `change.declared`. */
  readonly id: string;
  readonly verdict: TrustVerdict;
  readonly detail: string;
}

export interface TrustReport {
  readonly trust_report_version: '0';
  readonly producer: { readonly name: string; readonly version: string };
  readonly subject: { readonly kind: 'session' | 'run' | 'suite'; readonly id: string };
  readonly verdict: TrustVerdict;
  readonly checks: readonly TrustCheck[];
  readonly generated_at: string;
}

/** Which finding codes belong to which check dimension. */
const DIMENSIONS: ReadonlyArray<{
  readonly id: string;
  readonly codes: ReadonlySet<AttestFinding['code']>;
  readonly passDetail: (v: AttestVerdict) => string;
  /** Emit the check even when its inputs were provided and clean. */
  readonly evaluated: (v: AttestVerdict) => boolean;
}> = [
  {
    id: 'ledger.chain',
    codes: new Set(['EMPTY_LEDGER', 'CHAIN_BROKEN', 'TRUNCATED']),
    passDetail: v => `hash chain intact (${v.summary.records} records)`,
    evaluated: () => true,
  },
  {
    id: 'ledger.signatures',
    codes: new Set(['SIG_INVALID', 'NO_SIGNED_RECORDS', 'UNSIGNED_RECORDS']),
    passDetail: v => `${v.summary.signed} record signature(s) valid`,
    // Only meaningful when something was actually signed or a key was checked.
    evaluated: v => v.summary.signed > 0 || v.summary.invalidSignatures > 0,
  },
  {
    id: 'change.declared',
    codes: new Set(['UNDECLARED_CHANGE']),
    passDetail: v =>
      `${v.summary.changedFiles} changed file(s), every one backed by a ledger claim`,
    evaluated: v => v.summary.changedFiles > 0 || v.summary.undeclared.length > 0,
  },
  {
    id: 'change.in_scope',
    codes: new Set(['OUT_OF_SCOPE']),
    passDetail: () => 'all changes inside the declared scope',
    evaluated: v => v.summary.changedFiles > 0 || v.summary.outOfScope.length > 0,
  },
  {
    id: 'claims.consistent',
    codes: new Set(['CLAIMED_NOT_CHANGED']),
    passDetail: v => `${v.summary.claimedFiles} claimed file(s) consistent with the diff`,
    evaluated: v => v.summary.claimedFiles > 0,
  },
  {
    id: 'claims.tests',
    codes: new Set(['LAST_TEST_CLAIM_FAILED']),
    passDetail: () => 'no failing test claims',
    evaluated: () => true,
  },
];

function findingVerdict(finding: AttestFinding): TrustVerdict {
  return finding.severity === 'error' ? 'fail' : finding.severity === 'warning' ? 'warn' : 'pass';
}

function worst(verdicts: readonly TrustVerdict[]): TrustVerdict {
  if (verdicts.includes('fail')) return 'fail';
  if (verdicts.includes('warn')) return 'warn';
  return 'pass';
}

export interface TrustReportContext {
  readonly producerVersion: string;
  readonly subjectId: string;
  readonly now: () => Date;
}

/** Map an attest verdict onto the cross-tool Trust Report v0 shape. */
export function toTrustReport(verdict: AttestVerdict, ctx: TrustReportContext): TrustReport {
  const checks: TrustCheck[] = [];
  for (const dim of DIMENSIONS) {
    const findings = verdict.findings.filter(f => dim.codes.has(f.code));
    if (findings.length > 0) {
      checks.push({
        id: dim.id,
        verdict: worst(findings.map(findingVerdict)),
        detail: findings.map(f => `[${f.code}] ${f.message}`).join('; '),
      });
    } else if (dim.evaluated(verdict)) {
      checks.push({ id: dim.id, verdict: 'pass', detail: dim.passDetail(verdict) });
    }
  }

  return {
    trust_report_version: '0',
    producer: { name: 'nightwatch', version: ctx.producerVersion },
    subject: { kind: 'session', id: ctx.subjectId },
    verdict: worst(checks.map(c => c.verdict)),
    checks,
    generated_at: ctx.now().toISOString(),
  };
}
