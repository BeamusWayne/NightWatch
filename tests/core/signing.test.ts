import { describe, expect, it } from 'vitest';
import { GENESIS, sha256Hex } from '../../src/core/hash.js';
import { sealRecord } from '../../src/core/record.js';
import type { LedgerRecord } from '../../src/core/record.js';
import {
  generateKeyPair,
  signRecordHash,
  verifyLedgerSignatures,
  verifyRecordSignature,
} from '../../src/core/signing.js';
import { isNightWatchError } from '../../src/util/errors.js';

const HASH = sha256Hex('the quick brown fox');

function sealedNote(seq: number): LedgerRecord {
  return sealRecord({
    v: 1,
    seq,
    ts: new Date(1760000000000 + seq * 1000).toISOString(),
    session: 's1',
    agent: { harness: 'claude-code' },
    event: 'note',
    prev: seq === 0 ? GENESIS : 'b'.repeat(64),
  });
}

describe('generateKeyPair', () => {
  it('emits a PEM-encoded P-256 pair (pkcs8 private, spki public)', () => {
    const pair = generateKeyPair();
    expect(pair.privateKeyPem).toMatch(/^-----BEGIN PRIVATE KEY-----\n/);
    expect(pair.privateKeyPem.trimEnd()).toMatch(/-----END PRIVATE KEY-----$/);
    expect(pair.publicKeyPem).toMatch(/^-----BEGIN PUBLIC KEY-----\n/);
  });

  it('produces a distinct pair on every call', () => {
    expect(generateKeyPair().privateKeyPem).not.toBe(generateKeyPair().privateKeyPem);
  });
});

describe('signRecordHash / verifyRecordSignature', () => {
  const pair = generateKeyPair();

  it('roundtrips: a signature verifies against the matching public key', () => {
    const sig = signRecordHash(HASH, pair.privateKeyPem);
    expect(verifyRecordSignature(HASH, sig, pair.publicKeyPem)).toBe(true);
  });

  it('encodes the signature as base64 of DER (leading SEQUENCE tag)', () => {
    const sig = signRecordHash(HASH, pair.privateKeyPem);
    expect(sig).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(Buffer.from(sig, 'base64')[0]).toBe(0x30);
  });

  it('rejects a signature made by a different key', () => {
    const other = generateKeyPair();
    const sig = signRecordHash(HASH, other.privateKeyPem);
    expect(verifyRecordSignature(HASH, sig, pair.publicKeyPem)).toBe(false);
  });

  it('rejects a signature over a different hash', () => {
    const sig = signRecordHash(HASH, pair.privateKeyPem);
    expect(verifyRecordSignature(sha256Hex('other content'), sig, pair.publicKeyPem)).toBe(false);
  });

  it('verification returns false — never throws — on malformed inputs', () => {
    const sig = signRecordHash(HASH, pair.privateKeyPem);
    expect(verifyRecordSignature('not-a-hash', sig, pair.publicKeyPem)).toBe(false);
    expect(verifyRecordSignature(HASH, '@@not-base64@@', pair.publicKeyPem)).toBe(false);
    expect(verifyRecordSignature(HASH, Buffer.from('junk').toString('base64'), pair.publicKeyPem)).toBe(false);
    expect(verifyRecordSignature(HASH, sig, 'not a pem')).toBe(false);
  });

  it('signing rejects a non-hex hash with SIGNING_FAILED', () => {
    try {
      signRecordHash('xyz', pair.privateKeyPem);
      expect.unreachable('signRecordHash should have thrown');
    } catch (error) {
      expect(isNightWatchError(error) && error.code === 'SIGNING_FAILED').toBe(true);
    }
  });

  it('signing rejects an unusable private key with SIGNING_FAILED', () => {
    try {
      signRecordHash(HASH, 'not a pem');
      expect.unreachable('signRecordHash should have thrown');
    } catch (error) {
      expect(isNightWatchError(error) && error.code === 'SIGNING_FAILED').toBe(true);
    }
  });
});

describe('verifyLedgerSignatures', () => {
  const pair = generateKeyPair();

  function signed(seq: number): LedgerRecord {
    const record = sealedNote(seq);
    return { ...record, sig: signRecordHash(record.hash, pair.privateKeyPem) };
  }

  it('summarizes a mixed ledger and pinpoints invalid signatures by seq', () => {
    const forged: LedgerRecord = { ...sealedNote(2), sig: Buffer.from('forged').toString('base64') };
    const check = verifyLedgerSignatures([signed(0), sealedNote(1), forged, signed(3)], pair.publicKeyPem);
    expect(check).toEqual({
      ok: false,
      total: 4,
      signed: 3,
      verified: 2,
      unsigned: 1,
      invalidSeqs: [2],
    });
  });

  it('treats a fully unsigned ledger as valid (legacy stores)', () => {
    const check = verifyLedgerSignatures([sealedNote(0), sealedNote(1)], pair.publicKeyPem);
    expect(check).toEqual({ ok: true, total: 2, signed: 0, verified: 0, unsigned: 2, invalidSeqs: [] });
  });

  it('handles an empty ledger', () => {
    expect(verifyLedgerSignatures([], pair.publicKeyPem)).toEqual({
      ok: true,
      total: 0,
      signed: 0,
      verified: 0,
      unsigned: 0,
      invalidSeqs: [],
    });
  });
});
