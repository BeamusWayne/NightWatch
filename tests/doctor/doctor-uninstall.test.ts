import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runDoctor } from '../../src/doctor/doctor.js';
import { installHooks, installedHookEvents, uninstallHooks } from '../../src/hooks/install.js';
import { appendRecord } from '../../src/store/ledger.js';
import { ensureStore, storePathsAt } from '../../src/store/paths.js';
import type { ExecFn } from '../../src/util/exec.js';

const gitOk: ExecFn = () => ({ status: 0, stdout: 'true\n', stderr: '' });
const noGit: ExecFn = () => ({ status: 1, stdout: '', stderr: 'not a repo' });

function statusOf(checks: ReturnType<typeof runDoctor>, name: string): string | undefined {
  return checks.find(c => c.name === name)?.status;
}

describe('uninstallHooks', () => {
  it('removes only NightWatch entries and preserves foreign hooks', () => {
    const root = mkdtempSync(join(tmpdir(), 'nw-unins-'));
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(
      join(root, '.claude', 'settings.json'),
      JSON.stringify({
        permissions: { allow: ['Bash(ls:*)'] },
        hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'prettier --write' }] }] },
      }),
      'utf8',
    );
    installHooks(root);
    expect(installedHookEvents(root)).toHaveLength(5);

    const result = uninstallHooks(root);
    expect(result.removed).toHaveLength(5);
    expect(installedHookEvents(root)).toHaveLength(0);

    const settings = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf8')) as {
      permissions: unknown;
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    expect(settings.permissions).toEqual({ allow: ['Bash(ls:*)'] });
    expect(settings.hooks['PostToolUse']?.[0]?.hooks[0]?.command).toBe('prettier --write');
  });

  it('is a no-op without settings and idempotent after removal', () => {
    const root = mkdtempSync(join(tmpdir(), 'nw-unins2-'));
    expect(uninstallHooks(root).removed).toEqual([]);
    installHooks(root);
    uninstallHooks(root);
    expect(uninstallHooks(root).removed).toEqual([]);
  });
});

describe('runDoctor', () => {
  it('fails on missing hooks and warns on missing store', () => {
    const root = mkdtempSync(join(tmpdir(), 'nw-doc1-'));
    const checks = runDoctor(root, gitOk);
    expect(statusOf(checks, 'hooks')).toBe('fail');
    expect(statusOf(checks, 'store')).toBe('warn');
  });

  it('reports all green on a healthy recorded project', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nw-doc2-'));
    installHooks(root);
    const paths = storePathsAt(root);
    ensureStore(paths);
    await appendRecord(paths, {
      record: {
        v: 1,
        ts: new Date().toISOString(),
        session: 's1',
        agent: { harness: 'claude-code' },
        event: 'session_start',
      },
    });
    const checks = runDoctor(root, gitOk);
    expect(statusOf(checks, 'node')).toBe('ok');
    expect(statusOf(checks, 'hooks')).toBe('ok');
    expect(statusOf(checks, 'store')).toBe('ok');
    expect(statusOf(checks, 'ledger')).toBe('ok');
    expect(statusOf(checks, 'spill')).toBe('ok');
  });

  it('warns (not fails) without git, and fails on a broken chain', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nw-doc3-'));
    installHooks(root);
    const paths = storePathsAt(root);
    ensureStore(paths);
    await appendRecord(paths, {
      record: { v: 1, ts: new Date().toISOString(), session: 's1', agent: { harness: 'x' }, event: 'session_start' },
    });
    expect(statusOf(runDoctor(root, noGit), 'git')).toBe('warn');

    const file = join(paths.ledgerDir, 's1.jsonl');
    const tampered = readFileSync(file, 'utf8').replace('session_start', 'stop');
    writeFileSync(file, tampered, 'utf8');
    expect(statusOf(runDoctor(root, gitOk), 'ledger')).toBe('fail');
    expect(existsSync(file)).toBe(true);
  });
});
