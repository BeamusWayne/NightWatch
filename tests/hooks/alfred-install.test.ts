import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HOOK_COMMAND,
  installAlfredHooks,
  installedAlfredHookEvents,
  uninstallAlfredHooks,
} from '../../src/hooks/install.js';

const ALFRED_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'SessionEnd'];

function readHooks(root: string): { hooks: Array<{ event: string; command: string }> } {
  return JSON.parse(readFileSync(join(root, '.alfred', 'hooks.json'), 'utf8')) as {
    hooks: Array<{ event: string; command: string }>;
  };
}

describe('installAlfredHooks', () => {
  it('creates .alfred/hooks.json with one entry per recorded event', () => {
    const root = mkdtempSync(join(tmpdir(), 'nw-alfred-install-'));

    const result = installAlfredHooks(root);

    expect(result.added).toEqual(ALFRED_EVENTS);
    expect(existsSync(result.settingsPath)).toBe(true);
    const parsed = readHooks(root);
    expect(parsed.hooks).toHaveLength(5);
    for (const entry of parsed.hooks) {
      expect(entry.command).toBe(HOOK_COMMAND);
    }
  });

  it('is idempotent — a second init adds nothing', () => {
    const root = mkdtempSync(join(tmpdir(), 'nw-alfred-idem-'));
    installAlfredHooks(root);

    const second = installAlfredHooks(root);

    expect(second.added).toEqual([]);
    expect(second.alreadyPresent).toEqual(ALFRED_EVENTS);
    expect(readHooks(root).hooks).toHaveLength(5);
  });

  it('preserves foreign hooks and unknown top-level keys', () => {
    const root = mkdtempSync(join(tmpdir(), 'nw-alfred-preserve-'));
    mkdirSync(join(root, '.alfred'), { recursive: true });
    writeFileSync(
      join(root, '.alfred', 'hooks.json'),
      JSON.stringify({
        comment: 'user file',
        hooks: [{ event: 'PreToolUse', toolPattern: 'bash', command: 'my-own-guard' }],
      }),
    );

    installAlfredHooks(root);

    const parsed = JSON.parse(readFileSync(join(root, '.alfred', 'hooks.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(parsed['comment']).toBe('user file');
    const hooks = parsed['hooks'] as Array<{ command: string }>;
    expect(hooks.some(h => h.command === 'my-own-guard')).toBe(true);
    expect(hooks).toHaveLength(6);
  });

  it('throws on an unparseable file rather than clobbering it', () => {
    const root = mkdtempSync(join(tmpdir(), 'nw-alfred-bad-'));
    mkdirSync(join(root, '.alfred'), { recursive: true });
    writeFileSync(join(root, '.alfred', 'hooks.json'), '{ not json');

    expect(() => installAlfredHooks(root)).toThrowError(/cannot parse/);
    expect(readFileSync(join(root, '.alfred', 'hooks.json'), 'utf8')).toBe('{ not json');
  });
});

describe('uninstallAlfredHooks', () => {
  it('removes only NightWatch entries', () => {
    const root = mkdtempSync(join(tmpdir(), 'nw-alfred-uninstall-'));
    mkdirSync(join(root, '.alfred'), { recursive: true });
    writeFileSync(
      join(root, '.alfred', 'hooks.json'),
      JSON.stringify({ hooks: [{ event: 'PreToolUse', command: 'my-own-guard' }] }),
    );
    installAlfredHooks(root);

    const result = uninstallAlfredHooks(root);

    expect(result.removed).toEqual(ALFRED_EVENTS);
    const hooks = readHooks(root).hooks;
    expect(hooks).toHaveLength(1);
    expect(hooks[0]?.command).toBe('my-own-guard');
  });

  it('is a no-op without a hooks file', () => {
    const root = mkdtempSync(join(tmpdir(), 'nw-alfred-noop-'));
    expect(uninstallAlfredHooks(root).removed).toEqual([]);
  });
});

describe('installedAlfredHookEvents', () => {
  it('reports the events carrying a NightWatch entry', () => {
    const root = mkdtempSync(join(tmpdir(), 'nw-alfred-events-'));
    expect(installedAlfredHookEvents(root)).toEqual([]);

    installAlfredHooks(root);

    expect(installedAlfredHookEvents(root)).toEqual(ALFRED_EVENTS);
  });
});
