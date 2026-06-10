import { describe, expect, it } from 'vitest';
import { GENESIS } from '../../src/core/hash.js';
import { recordHashValid, sealRecord } from '../../src/core/record.js';
import type { UnhashedRecord } from '../../src/core/record.js';

function baseRecord(): UnhashedRecord {
  return {
    v: 1,
    seq: 0,
    ts: '2026-06-10T00:00:00.000Z',
    session: 's1',
    agent: { harness: 'claude-code' },
    event: 'tool_use',
    action: { tool: 'Read', class: 'read', input_digest: 'a'.repeat(64), summary: 'src/x.ts' },
    prev: GENESIS,
  };
}

describe('record sealing', () => {
  it('produces a stable 64-char hash', () => {
    const sealed = sealRecord(baseRecord());
    expect(sealed.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(sealRecord(baseRecord()).hash).toBe(sealed.hash);
  });

  it('validates an untouched record', () => {
    expect(recordHashValid(sealRecord(baseRecord()))).toBe(true);
  });

  it('detects any field tampering', () => {
    const sealed = sealRecord(baseRecord());
    expect(recordHashValid({ ...sealed, session: 's2' })).toBe(false);
    expect(recordHashValid({ ...sealed, seq: 1 })).toBe(false);
    expect(recordHashValid({ ...sealed, prev: 'f'.repeat(64) })).toBe(false);
  });

  it('hash depends on prev — same content at a different chain position differs', () => {
    const a = sealRecord(baseRecord());
    const b = sealRecord({ ...baseRecord(), prev: 'b'.repeat(64) });
    expect(a.hash).not.toBe(b.hash);
  });
});
