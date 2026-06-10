import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { appendRecord, loadHead, parseLedgerLines, readLedger, verifyChain } from '../../src/store/ledger.js';
import { ensureStore, ledgerFile, storePathsAt } from '../../src/store/paths.js';
import type { StorePaths } from '../../src/store/paths.js';

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
