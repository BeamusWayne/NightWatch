import { describe, expect, it } from 'vitest';
import { attest } from '../../src/attest/attest.js';
import { GENESIS } from '../../src/core/hash.js';
import { generateKeyPair, signRecordHash } from '../../src/core/signing.js';
import { sealRecord } from '../../src/core/record.js';
import type { Claim, LedgerRecord } from '../../src/core/record.js';

function chain(claimsBySeq: ReadonlyArray<readonly Claim[]>, signWith?: string): readonly LedgerRecord[] {
  const records: LedgerRecord[] = [];
  let prev = GENESIS;
  claimsBySeq.forEach((claims, seq) => {
    const sealed = sealRecord({
      v: 1,
      seq,
      ts: new Date(1760000000000 + seq * 1000).toISOString(),
      session: 's1',
      agent: { harness: 'claude-code' },
      event: 'tool_use',
      action: { tool: 'Edit', class: 'write', input_digest: 'a'.repeat(64), summary: `step-${seq}` },
      ...(claims.length > 0 ? { claims: [...claims] } : {}),
      prev,
    });
    prev = sealed.hash;
    records.push(signWith ? { ...sealed, sig: signRecordHash(sealed.hash, signWith) } : sealed);
  });
  return records;
}

const edit = (path: string): Claim => ({ type: 'file_change', path, via: 'Edit' });
const test = (outcome: 'ok' | 'failed'): Claim => ({ type: 'test_run', command: 'npx vitest run', outcome, summary: '' });

describe('attest', () => {
  it('attests a clean receipt: every changed file claimed, chain intact', () => {
    const records = chain([[edit('src/a.ts')], [test('ok')]]);
    const verdict = attest({ records, changedFiles: ['src/a.ts'], scopePatterns: ['src/**'] });
    expect(verdict.ok).toBe(true);
    expect(verdict.findings).toEqual([]);
    expect(verdict.summary.undeclared).toEqual([]);
  });

  it('refuses an empty ledger', () => {
    const verdict = attest({ records: [] });
    expect(verdict.ok).toBe(false);
    expect(verdict.findings[0]?.code).toBe('EMPTY_LEDGER');
  });

  it('refuses a broken chain at the exact record', () => {
    const records = chain([[edit('src/a.ts')], []]);
    const tampered = [records[0]!, { ...records[1]!, prev: 'f'.repeat(64) }];
    const verdict = attest({ records: tampered });
    expect(verdict.ok).toBe(false);
    expect(verdict.findings.some(f => f.code === 'CHAIN_BROKEN')).toBe(true);
  });

  it('refuses changed-but-never-claimed files — the core gate', () => {
    const records = chain([[edit('src/a.ts')]]);
    const verdict = attest({ records, changedFiles: ['src/a.ts', 'src/sneaky.ts'] });
    expect(verdict.ok).toBe(false);
    const undeclared = verdict.findings.filter(f => f.code === 'UNDECLARED_CHANGE');
    expect(undeclared).toHaveLength(1);
    expect(undeclared[0]?.message).toContain('src/sneaky.ts');
  });

  it('exempts the receipt itself and .nightwatch/ from the diff gate', () => {
    const records = chain([[edit('src/a.ts')]]);
    const verdict = attest({
      records,
      changedFiles: ['src/a.ts', 'receipt.jsonl', '.nightwatch/ledger/x.jsonl'],
      exemptPaths: ['receipt.jsonl'],
    });
    expect(verdict.ok).toBe(true);
  });

  it('flags out-of-scope changes even when claimed', () => {
    const records = chain([[edit('infra/deploy.yaml')]]);
    const verdict = attest({ records, changedFiles: ['infra/deploy.yaml'], scopePatterns: ['src/**'] });
    expect(verdict.ok).toBe(false);
    expect(verdict.findings.some(f => f.code === 'OUT_OF_SCOPE')).toBe(true);
  });

  it('relativizes absolute claimed paths via projectRoot', () => {
    const records = chain([[edit('/repo/src/a.ts')]]);
    const verdict = attest({ records, changedFiles: ['src/a.ts'], projectRoot: '/repo' });
    expect(verdict.ok).toBe(true);
  });

  it('verifies signatures and refuses an invalid one', () => {
    const keys = generateKeyPair();
    const good = chain([[edit('src/a.ts')]], keys.privateKeyPem);
    expect(attest({ records: good, publicKeyPem: keys.publicKeyPem }).ok).toBe(true);

    const forged = [{ ...good[0]!, sig: Buffer.from('forged').toString('base64') }];
    const verdict = attest({ records: forged, publicKeyPem: keys.publicKeyPem });
    expect(verdict.ok).toBe(false);
    expect(verdict.findings.some(f => f.code === 'SIG_INVALID')).toBe(true);
  });

  it('warns (not fails) on unsigned records in a keyed check — unless strict', () => {
    const keys = generateKeyPair();
    const unsigned = chain([[edit('src/a.ts')]]);
    const lax = attest({ records: unsigned, publicKeyPem: keys.publicKeyPem });
    expect(lax.ok).toBe(true);
    expect(lax.findings.some(f => f.code === 'NO_SIGNED_RECORDS')).toBe(true);

    const strict = attest({ records: unsigned, publicKeyPem: keys.publicKeyPem, strict: true });
    expect(strict.ok).toBe(false);
  });

  it('warns when the final recorded test run was failing — TDD red phases in the middle are fine', () => {
    const redGreen = chain([[test('failed')], [test('ok')]]);
    expect(attest({ records: redGreen }).findings.some(f => f.code === 'LAST_TEST_CLAIM_FAILED')).toBe(false);

    const endsRed = chain([[test('ok')], [test('failed')]]);
    const verdict = attest({ records: endsRed });
    expect(verdict.findings.some(f => f.code === 'LAST_TEST_CLAIM_FAILED')).toBe(true);
    expect(verdict.ok).toBe(true); // warning, not error
  });

  it('reports claimed-but-not-changed as info only', () => {
    const records = chain([[edit('src/a.ts')], [edit('src/reverted.ts')]]);
    const verdict = attest({ records, changedFiles: ['src/a.ts'] });
    expect(verdict.ok).toBe(true);
    expect(verdict.findings.some(f => f.code === 'CLAIMED_NOT_CHANGED' && f.severity === 'info')).toBe(true);
  });
});
