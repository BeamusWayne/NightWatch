import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../../src/debrief/render.js';
import { runDemo } from '../../src/demo.js';
import { realExec } from '../../src/util/exec.js';

const FIXTURE = fileURLToPath(new URL('../../fixtures/demo-session.json', import.meta.url));
const hasGit = realExec('git', ['--version']).status === 0;

describe.skipIf(!hasGit)('demo end-to-end', () => {
  it('replays the fixture through real ingest and produces a verifiable debrief', async () => {
    const { report } = await runDemo(FIXTURE);

    expect(report.chain.ok).toBe(true);
    expect(report.stats.events).toBeGreaterThanOrEqual(13);
    expect(report.model).toBe('claude-fable-5');

    // The fixture plants one out-of-scope edit and one out-of-band write.
    expect(report.scope.groundTruth).toBe('git');
    expect(report.scope.outOfScope).toContain('infra/deploy.yaml');
    expect(report.scope.unclaimed).toContain('scripts/hotfix.sh');

    // Test claims recorded: fail → pass → pass; git commit claimed.
    const outcomes = report.testClaims.map(c => c.claimedOutcome);
    expect(outcomes).toEqual(['failed', 'ok', 'ok']);
    expect(report.gitOps[0]?.op).toBe('commit');

    const en = renderMarkdown(report, 'en');
    const zh = renderMarkdown(report, 'zh');
    expect(en).toContain('infra/deploy.yaml');
    expect(zh).toContain('已变更但台账未声明');
  }, 30_000);
});
