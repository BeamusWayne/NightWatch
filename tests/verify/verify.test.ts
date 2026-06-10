import { describe, expect, it } from 'vitest';
import { GENESIS } from '../../src/core/hash.js';
import { sealRecord } from '../../src/core/record.js';
import type { Claim, LedgerRecord } from '../../src/core/record.js';
import type { ExecFn } from '../../src/util/exec.js';
import { globToRegExp, matchesAny } from '../../src/verify/glob.js';
import { analyzeScope } from '../../src/verify/scope.js';
import { verifyTestClaims } from '../../src/verify/tests.js';

function chained(claimsBySeq: ReadonlyArray<readonly Claim[]>): readonly LedgerRecord[] {
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
      action: { tool: 'Bash', class: 'exec', input_digest: 'a'.repeat(64), summary: `step-${seq}` },
      ...(claims.length > 0 ? { claims: [...claims] } : {}),
      prev,
    });
    prev = sealed.hash;
    records.push(sealed);
  });
  return records;
}

describe('glob', () => {
  it('supports **, * and ?', () => {
    expect(matchesAny('src/utils/date.ts', ['src/**'])).toBe(true);
    expect(matchesAny('src/a.ts', ['src/*.ts'])).toBe(true);
    expect(matchesAny('src/deep/a.ts', ['src/*.ts'])).toBe(false);
    expect(matchesAny('tests/x.test.ts', ['src/**', 'tests/**'])).toBe(true);
    expect(matchesAny('infra/deploy.yaml', ['src/**', 'tests/**'])).toBe(false);
    expect(globToRegExp('a?c').test('abc')).toBe(true);
    expect(globToRegExp('**/*.md').test('docs/x/y.md')).toBe(true);
    expect(globToRegExp('**/*.md').test('README.md')).toBe(true);
  });
});

describe('analyzeScope', () => {
  const fakeGit =
    (changed: readonly string[], untracked: readonly string[] = []): ExecFn =>
    (cmd, args) => {
      if (args[0] === 'rev-parse') return { status: 0, stdout: 'true\n', stderr: '' };
      if (args[0] === 'diff') return { status: 0, stdout: `${changed.join('\n')}\n`, stderr: '' };
      if (args[0] === 'ls-files') return { status: 0, stdout: `${untracked.join('\n')}\n`, stderr: '' };
      return { status: 1, stdout: '', stderr: `unexpected: ${cmd} ${args.join(' ')}` };
    };

  it('flags out-of-scope and unclaimed changes', () => {
    const records = chained([
      [{ type: 'file_change', path: 'src/utils/date.ts', via: 'Edit' }],
      [{ type: 'file_change', path: 'echo x >> scripts/hotfix.sh', via: 'Bash' }],
    ]);
    const report = analyzeScope(
      records,
      ['src/**', 'tests/**'],
      '/repo',
      undefined,
      fakeGit(['src/utils/date.ts', 'infra/deploy.yaml'], ['scripts/hotfix.sh']),
    );
    expect(report.groundTruth).toBe('git');
    expect(report.outOfScope).toEqual(['infra/deploy.yaml', 'scripts/hotfix.sh']);
    expect(report.unclaimed).toEqual(['infra/deploy.yaml', 'scripts/hotfix.sh']);
    expect(report.inScopeRatio).toBeCloseTo(1 / 3);
  });

  it('degrades without git', () => {
    const noGit: ExecFn = () => ({ status: 1, stdout: '', stderr: 'not a repo' });
    const report = analyzeScope(chained([[]]), [], '/repo', undefined, noGit);
    expect(report.groundTruth).toBe('unavailable');
  });

  it('relativizes absolute claimed paths against the project root (first self-run regression)', () => {
    const records = chained([[{ type: 'file_change', path: '/repo/src/utils/date.ts', via: 'Edit' }]]);
    const report = analyzeScope(records, ['src/**'], '/repo', undefined, fakeGit(['src/utils/date.ts']));
    expect(report.claimedPaths).toEqual(['src/utils/date.ts']);
    expect(report.unclaimed).toEqual([]);
    expect(report.outOfScope).toEqual([]);
  });
});

describe('verifyTestClaims', () => {
  const records = chained([
    [{ type: 'test_run', command: 'npm test', outcome: 'failed', summary: '2 failed' }],
    [{ type: 'test_run', command: 'npm test', outcome: 'ok', summary: '7 passed' }],
  ]);

  it('skips everything when rerun is disabled', () => {
    const results = verifyTestClaims(records, { rerun: false, cwd: '/repo' });
    expect(results.map(r => r.status)).toEqual(['skipped', 'skipped']);
  });

  it('verifies a pass claim that still passes', () => {
    const okExec: ExecFn = () => ({ status: 0, stdout: 'ok', stderr: '' });
    const results = verifyTestClaims(records, { rerun: true, cwd: '/repo', exec: okExec, lastN: 1 });
    expect(results[0]?.status).toBe('skipped');
    expect(results[1]?.status).toBe('verified');
  });

  it('flags a pass claim that now fails', () => {
    const badExec: ExecFn = () => ({ status: 1, stdout: '', stderr: 'boom' });
    const results = verifyTestClaims(records, { rerun: true, cwd: '/repo', exec: badExec, lastN: 1 });
    expect(results[1]?.status).toBe('now_failing');
  });
});
