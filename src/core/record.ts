import { z } from 'zod';
import { canonicalStringify } from './canonical.js';
import { sha256Hex } from './hash.js';

/**
 * One ledger record = one observed event in an agent run, hash-chained to its
 * predecessor. The shape is designed to map onto the concepts in IETF
 * draft-sharif-agent-audit-trail-00 (agent identity, action classification,
 * outcome, SHA-256 chaining) without claiming conformance to a moving draft.
 */

export const ACTION_CLASSES = ['read', 'write', 'exec', 'net', 'vcs', 'agent', 'other'] as const;
export type ActionClass = (typeof ACTION_CLASSES)[number];

export const claimSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('test_run'),
    command: z.string().min(1),
    /** ok = explicit pass signal and no fail signal; failed = explicit fail; unknown otherwise. */
    outcome: z.enum(['ok', 'failed', 'unknown']),
    summary: z.string(),
  }),
  z.object({
    type: z.literal('file_change'),
    path: z.string().min(1),
    via: z.string().min(1),
  }),
  z.object({
    type: z.literal('git_op'),
    op: z.string().min(1),
    command: z.string().min(1),
  }),
]);
export type Claim = z.infer<typeof claimSchema>;

export const ledgerRecordSchema = z.object({
  v: z.literal(1),
  seq: z.number().int().nonnegative(),
  ts: z.string().datetime({ offset: true }),
  session: z.string().min(1),
  agent: z.object({
    harness: z.string().min(1),
    model: z.string().optional(),
  }),
  event: z.enum(['session_start', 'prompt', 'tool_use', 'stop', 'session_end', 'checkpoint', 'note']),
  action: z
    .object({
      tool: z.string().min(1),
      class: z.enum(ACTION_CLASSES),
      input_digest: z.string().length(64),
      summary: z.string(),
    })
    .optional(),
  outcome: z
    .object({
      status: z.enum(['ok', 'error', 'unknown']),
      output_digest: z.string().length(64).optional(),
      detail: z.string().optional(),
    })
    .optional(),
  claims: z.array(claimSchema).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  prev: z.string().length(64),
  hash: z.string().length(64),
  /**
   * Optional ECDSA P-256 signature (base64 DER) over `hash`. Absent on records
   * written before a signing key existed — those stay valid forever.
   */
  sig: z.string().base64().min(1).optional(),
});
export type LedgerRecord = z.infer<typeof ledgerRecordSchema>;

/** Sealing input: everything except the seal (`hash`) and the seal's signature (`sig`). */
export type UnhashedRecord = Omit<LedgerRecord, 'hash' | 'sig'>;

/**
 * Hash covers every field except `hash` itself and `sig`; `prev` is inside,
 * forming the chain. `sig` MUST stay outside the hashed content: it is a
 * signature computed over this very hash, so hashing it back in would be
 * circular (the hash would change the moment it is signed). Stripping both
 * keys here keeps the hash identical whether the record is unhashed, sealed,
 * or signed — which is what keeps pre-signing ledgers verifiable.
 */
export function computeRecordHash(record: UnhashedRecord | LedgerRecord): string {
  const { hash: _hash, sig: _sig, ...content } = record as LedgerRecord;
  return sha256Hex(canonicalStringify(content));
}

export function sealRecord(record: UnhashedRecord): LedgerRecord {
  return { ...record, hash: computeRecordHash(record) };
}

/** Recompute and compare; returns false on any structural or hash mismatch. */
export function recordHashValid(record: LedgerRecord): boolean {
  return computeRecordHash(record) === record.hash;
}
