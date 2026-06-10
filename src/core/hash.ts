import { createHash } from 'node:crypto';
import { canonicalStringify } from './canonical.js';

/** Chain root sentinel: the `prev` of the first record in a ledger. */
export const GENESIS = '0'.repeat(64);

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Digest of any JSON-shaped value via canonical serialization. */
export function digestValue(value: unknown): string {
  return sha256Hex(canonicalStringify(value));
}
