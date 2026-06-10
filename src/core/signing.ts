import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { NightWatchError } from '../util/errors.js';
import type { LedgerRecord } from './record.js';

/**
 * Optional ECDSA signing of ledger records. The hash chain alone is
 * tamper-EVIDENT: an attacker who edits a record must re-hash and re-link
 * everything after it, which is detectable but not preventable. A signature
 * over each record hash makes the ledger tamper-RESISTANT: re-hashed records
 * cannot be re-signed without the private key, so a full-rewrite attack fails
 * signature verification even when the rebuilt chain self-validates.
 *
 * Signatures cover the record HASH, not the record content: the hash already
 * binds every content field (see computeRecordHash), so signing it transitively
 * signs the content — and keeps `sig` itself outside the hashed material.
 */

export interface KeyPairPem {
  readonly privateKeyPem: string;
  readonly publicKeyPem: string;
}

/** P-256 (prime256v1): universally available in node:crypto, no dependencies. */
const CURVE = 'prime256v1';
/** ECDSA needs a digest algorithm; SHA-256 matches the chain's hash function. */
const SIGN_DIGEST = 'sha256';
const HASH_HEX = /^[0-9a-f]{64}$/;

export function generateKeyPair(): KeyPairPem {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: CURVE,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return { privateKeyPem: privateKey, publicKeyPem: publicKey };
}

/** Sign a record hash; returns the DER-encoded ECDSA signature as base64. */
export function signRecordHash(hashHex: string, privateKeyPem: string): string {
  if (!HASH_HEX.test(hashHex)) {
    throw new NightWatchError('SIGNING_FAILED', 'record hash must be 64 lowercase hex chars');
  }
  try {
    return sign(SIGN_DIGEST, Buffer.from(hashHex, 'hex'), createPrivateKey(privateKeyPem)).toString('base64');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new NightWatchError('SIGNING_FAILED', `cannot sign record hash: ${reason}`);
  }
}

/** Verification is a predicate: any malformed input is simply not a valid signature. */
export function verifyRecordSignature(hashHex: string, signatureB64: string, publicKeyPem: string): boolean {
  if (!HASH_HEX.test(hashHex)) return false;
  try {
    return verify(
      SIGN_DIGEST,
      Buffer.from(hashHex, 'hex'),
      createPublicKey(publicKeyPem),
      Buffer.from(signatureB64, 'base64'),
    );
  } catch {
    return false;
  }
}

export interface SignatureCheck {
  /** False only on invalid signatures — unsigned records are a warning, not a failure. */
  readonly ok: boolean;
  readonly total: number;
  readonly signed: number;
  readonly verified: number;
  /** Records without `sig` (they predate the key or were written by an unkeyed store). */
  readonly unsigned: number;
  readonly invalidSeqs: readonly number[];
}

/**
 * Verify every signed record against the store's public key. Only meaningful
 * alongside verifyChain: this checks that each stored `hash` was signed by the
 * key holder, while the chain check proves `hash` still matches the content.
 */
export function verifyLedgerSignatures(records: readonly LedgerRecord[], publicKeyPem: string): SignatureCheck {
  const invalidSeqs: number[] = [];
  let signedCount = 0;
  for (const record of records) {
    if (record.sig === undefined) continue;
    signedCount += 1;
    if (!verifyRecordSignature(record.hash, record.sig, publicKeyPem)) invalidSeqs.push(record.seq);
  }
  return {
    ok: invalidSeqs.length === 0,
    total: records.length,
    signed: signedCount,
    verified: signedCount - invalidSeqs.length,
    unsigned: records.length - signedCount,
    invalidSeqs,
  };
}
