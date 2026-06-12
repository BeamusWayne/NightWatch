import type { ActionClass } from './record.js';

/**
 * Map a harness tool invocation to a coarse action class. Bash is sniffed by
 * command text because it is the escape hatch through which file writes and
 * network calls bypass the structured tools — exactly the events a reviewer
 * most wants classified.
 */

const TOOL_CLASS: Readonly<Record<string, ActionClass>> = Object.freeze({
  // Claude Code tool names
  read: 'read',
  glob: 'read',
  grep: 'read',
  notebookread: 'read',
  write: 'write',
  edit: 'write',
  multiedit: 'write',
  notebookedit: 'write',
  webfetch: 'net',
  websearch: 'net',
  agent: 'agent',
  task: 'agent',
  // Alfred (>= 0.7) tool names — same hook payloads, different vocabulary.
  // Found by the first recorded Alfred run: attest refused `add.ts` because
  // file_write produced no file_change claim (interop bug #6).
  file_read: 'read',
  file_edit: 'write',
  file_write: 'write',
  web_fetch: 'net',
  spawn_subagent: 'agent',
  memory_search: 'read',
});

const VCS_RE = /(?:^|[;&|]\s*)git\s+(commit|push|merge|rebase|reset|checkout|restore|revert|cherry-pick|tag|stash)\b/;
// `(?!&)` keeps fd duplication (`2>&1`, `>&2`) out of the write class — it
// redirects between descriptors, no file is touched. `2>err.log` still counts.
// Found by NightWatch's first recorded self-run (docs/runs/2026-06-10-*).
const WRITE_RE = /(?:^|[;&|]\s*)(?:rm|mv|cp|mkdir|touch|chmod|chown|ln|sed\s+-i|tee)\b|>{1,2}(?!&)\s*\S/;
const NET_RE = /(?:^|[;&|]\s*)(?:curl|wget|ssh|scp|rsync|nc)\b/;

export function classifyTool(toolName: string, input: Readonly<Record<string, unknown>>): ActionClass {
  const normalized = toolName.toLowerCase();
  if (normalized === 'bash') return classifyBashCommand(commandText(input));
  const mapped = TOOL_CLASS[normalized];
  if (mapped) return mapped;
  if (normalized.startsWith('mcp__')) return 'net';
  return 'other';
}

export function classifyBashCommand(command: string): ActionClass {
  if (VCS_RE.test(command)) return 'vcs';
  if (NET_RE.test(command)) return 'net';
  if (WRITE_RE.test(command)) return 'write';
  return 'exec';
}

export function commandText(input: Readonly<Record<string, unknown>>): string {
  const command = input['command'];
  return typeof command === 'string' ? command : '';
}

/** Best-effort primary target of a tool call, used for timelines and scope analysis. */
export function targetOf(toolName: string, input: Readonly<Record<string, unknown>>): string | undefined {
  for (const key of ['file_path', 'notebook_path', 'path', 'url', 'pattern']) {
    const value = input[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  if (toolName.toLowerCase() === 'bash') {
    const command = commandText(input);
    return command ? command.slice(0, 80) : undefined;
  }
  return undefined;
}
