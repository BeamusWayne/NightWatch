import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GENESIS } from '../core/hash.js';
import { computeRecordHash, ledgerRecordSchema, recordHashValid, sealRecord } from '../core/record.js';
import type { LedgerRecord, UnhashedRecord } from '../core/record.js';
import { NightWatchError } from '../util/errors.js';
import { headFile, ledgerFile } from './paths.js';
import type { StorePaths } from './paths.js';
import { withLock } from './lock.js';

/** Cached chain tip so appends are O(1) instead of rescanning the JSONL. */
export interface LedgerHead {
  readonly seq: number;
  readonly hash: string;
}

export interface AppendInput {
  readonly record: Omit<UnhashedRecord, 'seq' | 'prev'>;
}

export async function appendRecord(paths: StorePaths, input: AppendInput): Promise<LedgerRecord> {
  const session = input.record.session;
  const lockDir = join(paths.locksDir, `${session.replace(/[^A-Za-z0-9._-]/g, '_')}.lock`);

  return withLock(lockDir, () => {
    const head = loadHead(paths, session) ?? scanHead(paths, session);
    const sealed = sealRecord({
      ...input.record,
      seq: head ? head.seq + 1 : 0,
      prev: head ? head.hash : GENESIS,
    });
    appendFileSync(ledgerFile(paths, session), `${JSON.stringify(sealed)}\n`, 'utf8');
    saveHead(paths, session, { seq: sealed.seq, hash: sealed.hash });
    return sealed;
  });
}

export function readLedger(paths: StorePaths, session: string): readonly LedgerRecord[] {
  const file = ledgerFile(paths, session);
  if (!existsSync(file)) return [];
  return parseLedgerLines(readFileSync(file, 'utf8'));
}

export function parseLedgerLines(content: string): readonly LedgerRecord[] {
  const records: LedgerRecord[] = [];
  const lines = content.split('\n').filter(line => line.trim().length > 0);
  for (const [index, line] of lines.entries()) {
    const parsed = ledgerRecordSchema.safeParse(safeJson(line, index));
    if (!parsed.success) {
      throw new NightWatchError('LEDGER_CORRUPT', `record at line ${index + 1} failed validation`, {
        line: index + 1,
        issues: parsed.error.issues.slice(0, 3),
      });
    }
    records.push(parsed.data);
  }
  return records;
}

export interface ChainCheck {
  readonly ok: boolean;
  readonly length: number;
  readonly brokenAtSeq?: number;
  readonly reason?: string;
  /** Set when the head sidecar points past the file end — evidence of truncation. */
  readonly truncated?: boolean;
}

export function verifyChain(records: readonly LedgerRecord[], head?: LedgerHead): ChainCheck {
  let prev = GENESIS;
  for (const [index, record] of records.entries()) {
    if (record.seq !== index) {
      return { ok: false, length: records.length, brokenAtSeq: record.seq, reason: `expected seq ${index}, found ${record.seq}` };
    }
    if (record.prev !== prev) {
      return { ok: false, length: records.length, brokenAtSeq: record.seq, reason: 'prev pointer does not match previous record hash' };
    }
    if (!recordHashValid(record)) {
      return { ok: false, length: records.length, brokenAtSeq: record.seq, reason: 'record content does not match its hash' };
    }
    prev = record.hash;
  }
  if (head && (records.length === 0 || head.seq > records.length - 1)) {
    return { ok: false, length: records.length, reason: `head sidecar at seq ${head.seq} but ledger ends earlier`, truncated: true };
  }
  if (head && records.length > 0) {
    const last = records[records.length - 1];
    if (last && head.seq === last.seq && head.hash !== last.hash) {
      return { ok: false, length: records.length, brokenAtSeq: last.seq, reason: 'head sidecar hash disagrees with final record' };
    }
  }
  return { ok: true, length: records.length };
}

export function loadHead(paths: StorePaths, session: string): LedgerHead | undefined {
  const file = headFile(paths, session);
  if (!existsSync(file)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { seq?: unknown; hash?: unknown };
    if (typeof raw.seq === 'number' && typeof raw.hash === 'string' && raw.hash.length === 64) {
      return { seq: raw.seq, hash: raw.hash };
    }
  } catch {
    // Corrupt sidecar is recoverable: fall through to a full scan.
  }
  return undefined;
}

function saveHead(paths: StorePaths, session: string, head: LedgerHead): void {
  const file = headFile(paths, session);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(head), 'utf8');
  renameSync(tmp, file);
}

function scanHead(paths: StorePaths, session: string): LedgerHead | undefined {
  const records = readLedger(paths, session);
  const last = records[records.length - 1];
  return last ? { seq: last.seq, hash: last.hash } : undefined;
}

function safeJson(line: string, index: number): unknown {
  try {
    return JSON.parse(line);
  } catch {
    throw new NightWatchError('LEDGER_CORRUPT', `record at line ${index + 1} is not valid JSON`, { line: index + 1 });
  }
}

/** Exposed for tests: recompute what a record's hash should be. */
export const internals = { computeRecordHash };
