import { describe, expect, it } from 'vitest';
import { GENESIS } from '../../src/core/hash.js';
import { sealRecord } from '../../src/core/record.js';
import type { LedgerRecord, UnhashedRecord } from '../../src/core/record.js';
import { countFindings, renderMarkdown } from '../../src/debrief/render.js';
import type { DebriefReport } from '../../src/debrief/report.js';
import { areaOf, buildTimeline, spanHours } from '../../src/debrief/timeline.js';

function chainOf(parts: ReadonlyArray<Partial<UnhashedRecord>>): readonly LedgerRecord[] {
  const records: LedgerRecord[] = [];
  let prev = GENESIS;
  parts.forEach((part, seq) => {
    const sealed = sealRecord({
      v: 1,
      seq,
      ts: new Date(1760000000000 + seq * 60_000).toISOString(),
      session: 's1',
      agent: { harness: 'claude-code' },
      event: 'tool_use',
      action: { tool: 'Read', class: 'read', input_digest: 'a'.repeat(64), summary: 'src/a.ts' },
      ...part,
      prev,
    } as UnhashedRecord);
    prev = sealed.hash;
    records.push(sealed);
  });
  return records;
}

describe('timeline', () => {
  it('merges consecutive same-area same-class events into phases', () => {
    const records = chainOf([
      { action: { tool: 'Read', class: 'read', input_digest: 'a'.repeat(64), summary: 'src/a.ts' } },
      { action: { tool: 'Read', class: 'read', input_digest: 'a'.repeat(64), summary: 'src/b.ts' } },
      { action: { tool: 'Edit', class: 'write', input_digest: 'a'.repeat(64), summary: 'src/b.ts' } },
      { action: { tool: 'Bash', class: 'exec', input_digest: 'a'.repeat(64), summary: 'npx vitest run' } },
      { action: { tool: 'Bash', class: 'exec', input_digest: 'a'.repeat(64), summary: 'npx vitest run' } },
    ]);
    const phases = buildTimeline(records);
    expect(phases.map(p => [p.cls, p.count])).toEqual([
      ['read', 2],
      ['write', 1],
      ['exec', 2],
    ]);
    expect(phases[0]?.area).toBe('src');
  });

  it('areaOf groups by first path segment and class fallback', () => {
    expect(areaOf('src/utils/date.ts', 'write')).toBe('src');
    expect(areaOf('https://example.com/x', 'net')).toBe('web');
    expect(areaOf('npx vitest run', 'exec')).toBe('exec');
  });

  it('spanHours measures first→last record', () => {
    const records = chainOf([{}, {}, {}]);
    expect(spanHours(records)).toBeCloseTo(2 / 60);
  });
});

const REPORT: DebriefReport = {
  session: 'demo-1',
  generatedAt: '2026-06-10T07:00:00.000Z',
  model: 'claude-fable-5',
  goal: 'Fix the bug',
  spanHours: 8.5,
  stats: { events: 13, toolUses: 10, byClass: { read: 2, write: 3, exec: 3, net: 0, vcs: 1, agent: 0, other: 1 } },
  chain: { ok: true, length: 13 },
  phases: [
    {
      startSeq: 2, endSeq: 3, startTs: '2026-06-09T22:06:02+08:00', endTs: '2026-06-09T22:09:44+08:00',
      cls: 'read', area: 'src', count: 2, sampleTargets: ['src/utils/date.ts'],
    },
  ],
  testClaims: [
    { seq: 4, command: 'npx vitest run', claimedOutcome: 'ok', status: 'now_failing', detail: 'claimed pass, re-run exited 1' },
  ],
  gitOps: [{ seq: 11, op: 'commit', command: "git commit -am 'fix'" }],
  scope: {
    groundTruth: 'git',
    claimedPaths: ['src/utils/date.ts'],
    actualPaths: ['src/utils/date.ts', 'infra/deploy.yaml'],
    unclaimed: ['infra/deploy.yaml'],
    outOfScope: ['infra/deploy.yaml'],
    scopePatterns: ['src/**', 'tests/**'],
    inScopeRatio: 0.5,
  },
  checkpoints: [{ session: 'demo-1', seq: 0, commit: 'c'.repeat(40), tree: 't'.repeat(40), ts: '2026-06-09T22:04:00+08:00' }],
  spilledEvents: 0,
};

describe('render', () => {
  it('counts findings that should block blind trust', () => {
    expect(countFindings(REPORT)).toBe(3); // now_failing + out-of-scope + unclaimed
  });

  it('renders english markdown with verdict and flags', () => {
    const md = renderMarkdown(REPORT, 'en');
    expect(md).toContain('NightWatch Debrief');
    expect(md).toContain('claude-fable-5');
    expect(md).toContain('CLAIMED PASS, NOW FAILING');
    expect(md).toContain('infra/deploy.yaml');
    expect(md).toContain('OUT OF SCOPE');
  });

  it('renders the same report in Chinese', () => {
    const md = renderMarkdown(REPORT, 'zh');
    expect(md).toContain('NightWatch 晨报');
    expect(md).toContain('自称通过，重跑失败');
    expect(md).toContain('超出范围');
    expect(md).toContain('哈希链完整');
  });
});
