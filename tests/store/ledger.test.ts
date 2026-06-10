import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { sealRecord } from '../../src/core/record.js';
import type { LedgerRecord } from '../../src/core/record.js';
import { generateKeyPair, signRecordHash, verifyLedgerSignatures } from '../../src/core/signing.js';
import { appendRecord, loadHead, parseLedgerLines, readLedger, verifyChain } from '../../src/store/ledger.js';
import { ensureStore, ledgerFile, storePathsAt } from '../../src/store/paths.js';
import type { StorePaths } from '../../src/store/paths.js';
import { readSigningConfig, writeSigningKeys } from '../../src/store/signing.js';

const SESSION = 'sess-1';

function recordInput(n: number) {
  return {
    record: {
      v: 1 as const,
      ts: new Date(1760000000000 + n * 1000).toISOString(),
      session: SESSION,
      agent: { harness: 'claude-code' },
      event: 'tool_use' as const,
      action: { tool: 'Read', class: 'read' as const, input_digest: 'a'.repeat(64), summary: `file-${n}.ts` },
    },
  };
}

describe('ledger append + chain', () => {
  let paths: StorePaths;

  beforeEach(() => {
    paths = storePathsAt(mkdtempSync(join(tmpdir(), 'nw-ledger-')));
    ensureStore(paths);
  });

  it('appends with monotonically increasing seq and linked prev', async () => {
    for (let i = 0; i < 5; i++) await appendRecord(paths, recordInput(i));
    const records = readLedger(paths, SESSION);
    expect(records).toHaveLength(5);
    expect(records.map(r => r.seq)).toEqual([0, 1, 2, 3, 4]);
    expect(verifyChain(records, loadHead(paths, SESSION)).ok).toBe(true);
  });

  it('survives a deleted head sidecar by rescanning', async () => {
    await appendRecord(paths, recordInput(0));
    await appendRecord(paths, recordInput(1));
    writeFileSync(join(paths.headsDir, `${SESSION}.json`), 'garbage', 'utf8');
    await appendRecord(paths, recordInput(2));
    const records = readLedger(paths, SESSION);
    expect(records).toHaveLength(3);
    expect(verifyChain(records).ok).toBe(true);
  });

  it('detects content tampering at the exact record', async () => {
    for (let i = 0; i < 3; i++) await appendRecord(paths, recordInput(i));
    const file = ledgerFile(paths, SESSION);
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    const middle = JSON.parse(lines[1] as string) as Record<string, unknown>;
    (middle['action'] as Record<string, unknown>)['summary'] = 'evil.ts';
    lines[1] = JSON.stringify(middle);
    writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');

    const check = verifyChain(parseLedgerLines(readFileSync(file, 'utf8')));
    expect(check.ok).toBe(false);
    expect(check.brokenAtSeq).toBe(1);
  });

  it('detects truncation via the head sidecar', async () => {
    for (let i = 0; i < 3; i++) await appendRecord(paths, recordInput(i));
    const file = ledgerFile(paths, SESSION);
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    writeFileSync(file, `${lines.slice(0, 2).join('\n')}\n`, 'utf8');

    const check = verifyChain(readLedger(paths, SESSION), loadHead(paths, SESSION));
    expect(check.ok).toBe(false);
    expect(check.truncated).toBe(true);
  });

  it('handles concurrent appends without forking the chain', async () => {
    await Promise.all(Array.from({ length: 12 }, (_, i) => appendRecord(paths, recordInput(i))));
    const records = readLedger(paths, SESSION);
    expect(records).toHaveLength(12);
    expect(verifyChain(records, loadHead(paths, SESSION)).ok).toBe(true);
  });
});

describe('ledger signing', () => {
  let paths: StorePaths;

  beforeEach(() => {
    paths = storePathsAt(mkdtempSync(join(tmpdir(), 'nw-signing-')));
    ensureStore(paths);
  });

  it('resolves key paths under .nightwatch/keys/ even when no keys exist', () => {
    const config = readSigningConfig(paths);
    expect(config.privateKeyPath).toBe(join(paths.keysDir, 'signing.pem'));
    expect(config.publicKeyPath).toBe(join(paths.keysDir, 'signing.pub.pem'));
    expect(config.privateKeyPem).toBeUndefined();
    expect(config.publicKeyPem).toBeUndefined();
  });

  it('writeSigningKeys persists the pair and refuses to overwrite without force', () => {
    const written = writeSigningKeys(paths, generateKeyPair());
    expect(readFileSync(written.publicKeyPath, 'utf8')).toContain('BEGIN PUBLIC KEY');
    expect(() => writeSigningKeys(paths, generateKeyPair())).toThrowError(/--force/);
    const before = readFileSync(written.publicKeyPath, 'utf8');
    writeSigningKeys(paths, generateKeyPair(), { force: true });
    expect(readFileSync(written.publicKeyPath, 'utf8')).not.toBe(before);
  });

  it('keeps the private key owner-only', () => {
    const { privateKeyPath } = writeSigningKeys(paths, generateKeyPair());
    expect(statSync(privateKeyPath).mode & 0o077).toBe(0);
  });

  it('rejects an empty key file instead of silently appending unsigned', () => {
    mkdirSync(paths.keysDir, { recursive: true });
    writeFileSync(join(paths.keysDir, 'signing.pem'), '\n', 'utf8');
    expect(() => readSigningConfig(paths)).toThrowError(/empty/);
  });

  it('signs appends once keys exist; chain and signatures both verify', async () => {
    writeSigningKeys(paths, generateKeyPair());
    for (let i = 0; i < 3; i++) await appendRecord(paths, recordInput(i));
    const records = readLedger(paths, SESSION);
    expect(records.every(r => typeof r.sig === 'string' && r.sig.length > 0)).toBe(true);
    expect(verifyChain(records, loadHead(paths, SESSION)).ok).toBe(true);
    const check = verifyLedgerSignatures(records, readSigningConfig(paths).publicKeyPem ?? '');
    expect(check).toMatchObject({ ok: true, signed: 3, verified: 3, unsigned: 0 });
  });

  it('flags a tampered signature while the chain itself stays intact', async () => {
    const pair = generateKeyPair();
    writeSigningKeys(paths, pair);
    for (let i = 0; i < 3; i++) await appendRecord(paths, recordInput(i));
    const file = ledgerFile(paths, SESSION);
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    const middle = JSON.parse(lines[1] as string) as Record<string, unknown>;
    middle['sig'] = signRecordHash('c'.repeat(64), pair.privateKeyPem); // real key, wrong hash
    lines[1] = JSON.stringify(middle);
    writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');

    const records = readLedger(paths, SESSION);
    expect(verifyChain(records, loadHead(paths, SESSION)).ok).toBe(true); // sig sits outside the hash
    const check = verifyLedgerSignatures(records, pair.publicKeyPem);
    expect(check.ok).toBe(false);
    expect(check.invalidSeqs).toEqual([1]);
  });

  it('catches a full re-hash rewrite: chain re-validates but signatures cannot be forged', async () => {
    writeSigningKeys(paths, generateKeyPair());
    for (let i = 0; i < 3; i++) await appendRecord(paths, recordInput(i));

    // Attacker without the private key edits record 1, then re-hashes and
    // re-links the rest of the chain and refreshes the head sidecar.
    const original = readLedger(paths, SESSION);
    const rewritten: LedgerRecord[] = [original[0] as LedgerRecord];
    for (const record of original.slice(1)) {
      const { hash: _hash, sig, ...content } = record;
      const prev = (rewritten[rewritten.length - 1] as LedgerRecord).hash;
      const edited =
        record.seq === 1 && record.action
          ? { ...content, prev, action: { ...record.action, summary: 'evil.ts' } }
          : { ...content, prev };
      rewritten.push({ ...sealRecord(edited), ...(sig !== undefined ? { sig } : {}) });
    }
    writeFileSync(ledgerFile(paths, SESSION), `${rewritten.map(r => JSON.stringify(r)).join('\n')}\n`, 'utf8');
    const tip = rewritten[rewritten.length - 1] as LedgerRecord;
    writeFileSync(join(paths.headsDir, `${SESSION}.json`), JSON.stringify({ seq: tip.seq, hash: tip.hash }), 'utf8');

    const records = readLedger(paths, SESSION);
    expect(verifyChain(records, loadHead(paths, SESSION)).ok).toBe(true); // tamper-evidence alone is defeated
    const check = verifyLedgerSignatures(records, readSigningConfig(paths).publicKeyPem ?? '');
    expect(check.ok).toBe(false); // …but signatures over the new hashes cannot be produced
    expect(check.invalidSeqs).toEqual([1, 2]);
  });

  it('keeps legacy unsigned records valid alongside signed ones', async () => {
    await appendRecord(paths, recordInput(0)); // pre-key: stays unsigned forever
    writeSigningKeys(paths, generateKeyPair());
    await appendRecord(paths, recordInput(1));
    const records = readLedger(paths, SESSION);
    expect(records[0]?.sig).toBeUndefined();
    expect(typeof records[1]?.sig).toBe('string');
    expect(verifyChain(records, loadHead(paths, SESSION)).ok).toBe(true);
    expect(verifyLedgerSignatures(records, readSigningConfig(paths).publicKeyPem ?? '')).toMatchObject({
      ok: true,
      total: 2,
      signed: 1,
      verified: 1,
      unsigned: 1,
    });
  });

  it('appends stay sig-free when no key is configured', async () => {
    await appendRecord(paths, recordInput(0));
    const record = readLedger(paths, SESSION)[0];
    expect(record).toBeDefined();
    expect(record && 'sig' in record).toBe(false);
  });
});
