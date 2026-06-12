import { describe, expect, it } from 'vitest';
import { attest } from '../../src/attest/attest.js';
import { toTrustReport } from '../../src/attest/trustReport.js';
import { GENESIS } from '../../src/core/hash.js';
import { sealRecord } from '../../src/core/record.js';
import type { Claim, LedgerRecord } from '../../src/core/record.js';

function chain(claimsBySeq: ReadonlyArray<readonly Claim[]>): readonly LedgerRecord[] {
  const records: LedgerRecord[] = [];
  let prev = GENESIS;
  claimsBySeq.forEach((claims, seq) => {
    const sealed = sealRecord({
      v: 1,
      seq,
      ts: new Date(1760000000000 + seq * 1000).toISOString(),
      session: 's1',
      agent: { harness: 'alfred' },
      event: 'tool_use',
      action: { tool: 'Edit', class: 'write', input_digest: 'a'.repeat(64), summary: `step-${seq}` },
      ...(claims.length > 0 ? { claims: [...claims] } : {}),
      prev,
    });
    prev = sealed.hash;
    records.push(sealed);
  });
  return records;
}

const edit = (path: string): Claim => ({ type: 'file_change', path, via: 'Edit' });

const ctx = {
  producerVersion: '0.5.0',
  subjectId: 's1',
  now: () => new Date('2026-06-13T00:00:00.000Z'),
};

describe('toTrustReport', () => {
  it('maps a clean attested receipt to an all-pass report', () => {
    const verdict = attest({
      records: chain([[edit('src/a.ts')]]),
      changedFiles: ['src/a.ts'],
      scopePatterns: ['src/**'],
    });

    const report = toTrustReport(verdict, ctx);

    expect(report.trust_report_version).toBe('0');
    expect(report.producer).toEqual({ name: 'nightwatch', version: '0.5.0' });
    expect(report.subject).toEqual({ kind: 'session', id: 's1' });
    expect(report.verdict).toBe('pass');
    const ids = report.checks.map(c => c.id);
    expect(ids).toContain('ledger.chain');
    expect(ids).toContain('change.declared');
    expect(ids).toContain('change.in_scope');
    expect(report.checks.every(c => c.verdict === 'pass')).toBe(true);
    expect(report.generated_at).toBe('2026-06-13T00:00:00.000Z');
  });

  it('a broken chain fails ledger.chain and the overall verdict', () => {
    const records = chain([[edit('src/a.ts')], []]);
    const tampered = [records[0]!, { ...records[1]!, prev: 'f'.repeat(64) }];

    const report = toTrustReport(attest({ records: tampered }), ctx);

    const chainCheck = report.checks.find(c => c.id === 'ledger.chain');
    expect(chainCheck?.verdict).toBe('fail');
    expect(chainCheck?.detail).toContain('CHAIN_BROKEN');
    expect(report.verdict).toBe('fail');
  });

  it('an undeclared change fails change.declared', () => {
    const verdict = attest({
      records: chain([[edit('src/a.ts')]]),
      changedFiles: ['src/a.ts', 'scripts/hotfix.sh'],
    });

    const report = toTrustReport(verdict, ctx);

    const declared = report.checks.find(c => c.id === 'change.declared');
    expect(declared?.verdict).toBe('fail');
    expect(declared?.detail).toContain('UNDECLARED_CHANGE');
  });

  it('skips checks whose inputs were never provided', () => {
    // No changedFiles, no signatures: only chain + test-claim dimensions remain.
    const report = toTrustReport(attest({ records: chain([[edit('src/a.ts')]]) }), ctx);

    const ids = report.checks.map(c => c.id);
    expect(ids).not.toContain('ledger.signatures');
    expect(ids).not.toContain('change.declared');
    expect(ids).not.toContain('change.in_scope');
  });
});
