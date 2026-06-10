import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRecordFromPayload, ingest } from '../../src/hooks/ingest.js';
import { HOOK_COMMAND, installHooks } from '../../src/hooks/install.js';
import { readLedger, verifyChain } from '../../src/store/ledger.js';
import { storePathsAt } from '../../src/store/paths.js';

const NOW = () => new Date('2026-06-10T00:00:00.000Z');

describe('buildRecordFromPayload', () => {
  it('builds a tool_use record with digests, class and claims', () => {
    const record = buildRecordFromPayload(
      {
        session_id: 's1',
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'npx vitest run' },
        tool_response: { stdout: 'Tests  3 passed (3)' },
      },
      { now: NOW, harness: 'claude-code' },
    );
    expect(record).toBeDefined();
    expect(record?.event).toBe('tool_use');
    expect(record?.action?.class).toBe('exec');
    expect(record?.action?.input_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(record?.claims?.[0]).toMatchObject({ type: 'test_run', outcome: 'ok' });
  });

  it('stores only a digest and preview for prompts', () => {
    const longPrompt = `do the thing ${'x'.repeat(500)}`;
    const record = buildRecordFromPayload(
      { session_id: 's1', hook_event_name: 'UserPromptSubmit', prompt: longPrompt },
      { now: NOW, harness: 'claude-code' },
    );
    expect(record?.event).toBe('prompt');
    const preview = record?.meta?.['prompt_preview'];
    expect(typeof preview).toBe('string');
    expect((preview as string).length).toBeLessThanOrEqual(240);
  });

  it('relativizes claim paths against the session cwd — receipts must verify on other machines', () => {
    const record = buildRecordFromPayload(
      {
        session_id: 's1',
        hook_event_name: 'PostToolUse',
        cwd: '/work/repo',
        tool_name: 'Edit',
        tool_input: { file_path: '/work/repo/src/a.ts' },
        tool_response: 'ok',
      },
      { now: NOW, harness: 'claude-code' },
    );
    expect(record?.claims?.[0]).toMatchObject({ type: 'file_change', path: 'src/a.ts' });
  });

  it('returns undefined for hook events it does not record', () => {
    const record = buildRecordFromPayload(
      { session_id: 's1', hook_event_name: 'PreCompact' },
      { now: NOW, harness: 'claude-code' },
    );
    expect(record).toBeUndefined();
  });
});

describe('ingest (fail-open)', () => {
  it('appends a valid chain end to end', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nw-ingest-'));
    const result = await ingest(
      { session_id: 's1', hook_event_name: 'SessionStart', source: 'startup' },
      root,
      { now: NOW, harness: 'claude-code' },
    );
    expect(result.status).toBe('appended');
    const paths = storePathsAt(root);
    expect(verifyChain(readLedger(paths, 's1')).ok).toBe(true);
  });

  it('never throws — spills when the store is unwritable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nw-ingest-ro-'));
    const paths = storePathsAt(root);
    mkdirSync(paths.ledgerDir, { recursive: true });
    mkdirSync(paths.spillDir, { recursive: true });
    chmodSync(paths.ledgerDir, 0o500); // ledger unwritable, spill still writable
    try {
      const result = await ingest(
        { session_id: 's1', hook_event_name: 'SessionStart' },
        root,
        { now: NOW, harness: 'claude-code' },
      );
      expect(result.status).toBe('spilled');
      expect(readdirSync(paths.spillDir).length).toBeGreaterThan(0);
    } finally {
      chmodSync(paths.ledgerDir, 0o700);
    }
  });
});

describe('installHooks', () => {
  it('creates settings.json with all five events', () => {
    const root = mkdtempSync(join(tmpdir(), 'nw-install-'));
    const result = installHooks(root);
    expect(result.added).toEqual(['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'SessionEnd']);
    const settings = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf8')) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    expect(settings.hooks['PostToolUse']?.[0]?.hooks[0]?.command).toBe(HOOK_COMMAND);
  });

  it('is idempotent and preserves existing hooks', () => {
    const root = mkdtempSync(join(tmpdir(), 'nw-install2-'));
    const settingsPath = join(root, '.claude', 'settings.json');
    mkdirSync(join(root, '.claude'), { recursive: true });
    const existing = {
      permissions: { allow: ['Bash(ls:*)'] },
      hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'prettier --write' }] }] },
    };
    writeFileSync(settingsPath, JSON.stringify(existing), 'utf8');

    const first = installHooks(root);
    expect(first.added).toContain('PostToolUse');
    const second = installHooks(root);
    expect(second.added).toEqual([]);
    expect(second.alreadyPresent).toHaveLength(5);

    const merged = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
      permissions: unknown;
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    expect(merged.permissions).toEqual(existing.permissions);
    expect(merged.hooks['PostToolUse']?.[0]?.hooks[0]?.command).toBe('prettier --write');
    expect(merged.hooks['PostToolUse']).toHaveLength(2);
    expect(existsSync(settingsPath)).toBe(true);
  });
});
