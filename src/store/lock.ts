import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NightWatchError } from '../util/errors.js';

/**
 * Minimal cross-process mutex via atomic `mkdir`. PostToolUse hooks can fire
 * concurrently when the agent runs tools in parallel; without this, two
 * appends interleave and the hash chain forks. Stale locks (crashed holder)
 * are evicted by age + pid liveness so a SIGKILL'd hook can't wedge the store.
 */

const RETRY_INTERVAL_MS = 25;
const STALE_AFTER_MS = 15_000;

export interface LockOptions {
  readonly timeoutMs?: number;
  /** Injectable clock/sleep for tests. */
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export async function withLock<T>(lockDir: string, fn: () => Promise<T> | T, options: LockOptions = {}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const deadline = now() + timeoutMs;

  for (;;) {
    if (tryAcquire(lockDir)) break;
    evictIfStale(lockDir, now);
    if (now() >= deadline) {
      throw new NightWatchError('LEDGER_LOCKED', `could not acquire ${lockDir} within ${timeoutMs}ms`);
    }
    await sleep(RETRY_INTERVAL_MS);
  }

  try {
    return await fn();
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

function tryAcquire(lockDir: string): boolean {
  try {
    mkdirSync(lockDir);
    writeFileSync(join(lockDir, 'pid'), String(process.pid));
    return true;
  } catch {
    return false;
  }
}

function evictIfStale(lockDir: string, now: () => number): void {
  try {
    const age = now() - statSync(lockDir).mtimeMs;
    if (age < STALE_AFTER_MS) return;
    const pid = Number(readFileSync(join(lockDir, 'pid'), 'utf8'));
    if (Number.isInteger(pid) && pid > 0 && pidAlive(pid)) return;
    rmSync(lockDir, { recursive: true, force: true });
  } catch {
    // Lock vanished between checks or pid file unreadable past staleness:
    // either way the next acquire attempt decides.
    rmSync(lockDir, { recursive: true, force: true });
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
