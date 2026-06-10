import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { createCheckpoint } from './checkpoint/checkpoints.js';
import { hookPayloadSchema } from './hooks/payloads.js';
import { ingest } from './hooks/ingest.js';
import { buildDebrief } from './debrief/report.js';
import type { DebriefReport } from './debrief/report.js';
import { updateMeta } from './store/meta.js';
import { ensureStore, storePathsAt } from './store/paths.js';
import { realExec } from './util/exec.js';
import type { ExecFn } from './util/exec.js';

/**
 * Self-contained demo: replays a bundled synthetic overnight session through
 * the REAL ingest/checkpoint/debrief pipeline inside a throwaway git repo.
 * Nothing is mocked except the clock — the point is to show actual ledger
 * mechanics in 30 seconds without needing a Claude Code session first.
 */

const fixtureSchema = z.object({
  session: z.string(),
  goal: z.string(),
  scope: z.array(z.string()),
  events: z.array(
    z.object({
      at: z.string(),
      payload: hookPayloadSchema,
      materialize: z.array(z.object({ path: z.string(), content: z.string() })).optional(),
    }),
  ),
});

export interface DemoResult {
  readonly projectRoot: string;
  readonly session: string;
  readonly report: DebriefReport;
}

export async function runDemo(fixturePath: string, exec: ExecFn = realExec): Promise<DemoResult> {
  const fixture = fixtureSchema.parse(JSON.parse(readFileSync(fixturePath, 'utf8')));
  const projectRoot = mkdtempSync(join(tmpdir(), 'nightwatch-demo-'));

  seedRepo(projectRoot, exec);
  const paths = storePathsAt(projectRoot);
  ensureStore(paths);
  updateMeta(paths, { goal: fixture.goal, scope: fixture.scope, createdAt: new Date().toISOString() });

  // Baseline checkpoint before the "agent" changes anything: the scope check
  // diffs against this snapshot, exactly as the Stop hook would in real use.
  createCheckpoint(paths, projectRoot, fixture.session, 'demo baseline', exec);

  for (const event of fixture.events) {
    for (const file of event.materialize ?? []) {
      const target = join(projectRoot, file.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.content, 'utf8');
    }
    const at = new Date(event.at);
    await ingest(event.payload, projectRoot, { now: () => at, harness: 'claude-code' });
  }

  const report = buildDebrief(paths, {
    session: fixture.session,
    projectRoot,
    rerunTests: false,
    exec,
  });
  return { projectRoot, session: fixture.session, report };
}

function seedRepo(projectRoot: string, exec: ExecFn): void {
  const seed = (path: string, content: string): void => {
    const target = join(projectRoot, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, 'utf8');
  };
  seed('src/utils/date.ts', 'export function rolloverUtc(ts: number): string {\n  return new Date(ts).toISOString(); // BUG: ignores rollover\n}\n');
  seed('tests/date.test.ts', "import { rolloverUtc } from '../src/utils/date';\n// 5 passing cases, 2 failing rollover cases\n");
  seed('infra/deploy.yaml', 'replicas: 2\n');
  seed('package.json', '{ "name": "demo-app", "private": true }\n');
  seed('.gitignore', '.nightwatch/\nnode_modules/\n');

  if (exec('git', ['init', '-q', '-b', 'main'], { cwd: projectRoot }).status !== 0) return;
  const env = {
    GIT_AUTHOR_NAME: 'demo',
    GIT_AUTHOR_EMAIL: 'demo@local',
    GIT_COMMITTER_NAME: 'demo',
    GIT_COMMITTER_EMAIL: 'demo@local',
  };
  exec('git', ['add', '-A'], { cwd: projectRoot, env });
  exec('git', ['commit', '-q', '-m', 'seed: demo app before the overnight run'], { cwd: projectRoot, env });
}
