import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { NightWatchError } from '../util/errors.js';

/**
 * Installs NightWatch into a project's `.claude/settings.json` hooks. The
 * merge is idempotent (re-running `init` never duplicates entries) and
 * preserving (existing hooks from other tools are never touched). Detection
 * is by command substring so users can customize flags without re-triggering
 * installation.
 */

export const HOOK_COMMAND = 'npx --no-install nightwatch hook';
const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'SessionEnd'] as const;
const COMMAND_MARKER = 'nightwatch hook';

interface HookEntry {
  matcher?: string;
  hooks: Array<{ type: string; command: string; timeout?: number }>;
}

type SettingsShape = Record<string, unknown> & {
  hooks?: Record<string, HookEntry[]>;
};

export interface InstallResult {
  readonly settingsPath: string;
  readonly added: readonly string[];
  readonly alreadyPresent: readonly string[];
}

export function installHooks(projectRoot: string): InstallResult {
  const settingsPath = join(projectRoot, '.claude', 'settings.json');
  const settings = readSettings(settingsPath);
  const hooks: Record<string, HookEntry[]> = { ...(settings.hooks ?? {}) };

  const added: string[] = [];
  const alreadyPresent: string[] = [];

  for (const event of HOOK_EVENTS) {
    const entries = hooks[event] ?? [];
    if (entries.some(containsNightwatchCommand)) {
      alreadyPresent.push(event);
      continue;
    }
    hooks[event] = [...entries, { matcher: '*', hooks: [{ type: 'command', command: HOOK_COMMAND }] }];
    added.push(event);
  }

  if (added.length > 0) {
    const next: SettingsShape = { ...settings, hooks };
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  }
  return { settingsPath, added, alreadyPresent };
}

function containsNightwatchCommand(entry: HookEntry): boolean {
  return (entry.hooks ?? []).some(hook => typeof hook.command === 'string' && hook.command.includes(COMMAND_MARKER));
}

export interface UninstallResult {
  readonly settingsPath: string;
  readonly removed: readonly string[];
}

/** Exact inverse of installHooks: ours go, every foreign hook stays untouched. */
export function uninstallHooks(projectRoot: string): UninstallResult {
  const settingsPath = join(projectRoot, '.claude', 'settings.json');
  if (!existsSync(settingsPath)) return { settingsPath, removed: [] };

  const settings = readSettings(settingsPath);
  const hooks: Record<string, HookEntry[]> = { ...(settings.hooks ?? {}) };
  const removed: string[] = [];

  for (const [event, entries] of Object.entries(hooks)) {
    const kept = entries.filter(entry => !containsNightwatchCommand(entry));
    if (kept.length === entries.length) continue;
    removed.push(event);
    if (kept.length === 0) delete hooks[event];
    else hooks[event] = kept;
  }

  if (removed.length > 0) {
    const next: SettingsShape = { ...settings, hooks };
    if (Object.keys(hooks).length === 0) delete next.hooks;
    writeFileSync(settingsPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  }
  return { settingsPath, removed };
}

/** Hook events that currently carry a NightWatch entry (doctor uses this). */
export function installedHookEvents(projectRoot: string): readonly string[] {
  const settingsPath = join(projectRoot, '.claude', 'settings.json');
  if (!existsSync(settingsPath)) return [];
  try {
    const settings = readSettings(settingsPath);
    return Object.entries(settings.hooks ?? {})
      .filter(([, entries]) => entries.some(containsNightwatchCommand))
      .map(([event]) => event);
  } catch {
    return [];
  }
}

function readSettings(settingsPath: string): SettingsShape {
  if (!existsSync(settingsPath)) return {};
  const raw = readFileSync(settingsPath, 'utf8');
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('settings root is not an object');
    }
    return parsed as SettingsShape;
  } catch (error) {
    // Refuse to overwrite a file we cannot faithfully merge back.
    throw new NightWatchError('SETTINGS_MERGE_FAILED', `cannot parse ${settingsPath}: ${String(error)}`, {
      settingsPath,
    });
  }
}
