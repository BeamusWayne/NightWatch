import { spawnSync } from 'node:child_process';

/**
 * Thin, injectable wrapper around spawnSync. Everything that shells out
 * (git plumbing, test re-runs) accepts an ExecFn so tests can substitute a
 * fake instead of depending on the host machine.
 */

export interface ExecResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export type ExecFn = (cmd: string, args: readonly string[], options?: ExecOptions) => ExecResult;

export interface ExecOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly input?: string;
}

export const realExec: ExecFn = (cmd, args, options = {}) => {
  const result = spawnSync(cmd, [...args], {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    timeout: options.timeoutMs ?? 60_000,
    input: options.input,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
};

/** Run a full shell command line (used only for re-running claimed test commands). */
export const realShellExec: ExecFn = (cmd, args, options = {}) => {
  const line = [cmd, ...args].join(' ');
  const result = spawnSync(line, {
    shell: true,
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    timeout: options.timeoutMs ?? 300_000,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
};
