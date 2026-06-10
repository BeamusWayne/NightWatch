import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { NightWatchError } from '../util/errors.js';

/** Layout of the on-disk store, all under `<project>/.nightwatch/`. */
export interface StorePaths {
  readonly root: string;
  readonly ledgerDir: string;
  readonly headsDir: string;
  readonly locksDir: string;
  readonly spillDir: string;
  /** Created on demand by `nightwatch keygen`, not by ensureStore. */
  readonly keysDir: string;
  readonly metaFile: string;
  readonly checkpointsFile: string;
  readonly errorLog: string;
}

export const STORE_DIRNAME = '.nightwatch';

export function storePathsAt(projectRoot: string): StorePaths {
  const root = join(resolve(projectRoot), STORE_DIRNAME);
  return Object.freeze({
    root,
    ledgerDir: join(root, 'ledger'),
    headsDir: join(root, 'heads'),
    locksDir: join(root, 'locks'),
    spillDir: join(root, 'spill'),
    keysDir: join(root, 'keys'),
    metaFile: join(root, 'meta.json'),
    checkpointsFile: join(root, 'checkpoints.json'),
    errorLog: join(root, 'errors.log'),
  });
}

export function ensureStore(paths: StorePaths): void {
  for (const dir of [paths.root, paths.ledgerDir, paths.headsDir, paths.locksDir, paths.spillDir]) {
    mkdirSync(dir, { recursive: true });
  }
}

/** Walk upward from `start` until a directory containing `.nightwatch/` is found. */
export function findProjectRoot(start: string): string {
  let current = resolve(start);
  for (;;) {
    if (existsSync(join(current, STORE_DIRNAME))) return current;
    const parent = dirname(current);
    if (parent === current) {
      throw new NightWatchError('STORE_NOT_FOUND', `no ${STORE_DIRNAME}/ found from ${start}; run \`nightwatch init\` first`);
    }
    current = parent;
  }
}

export function ledgerFile(paths: StorePaths, session: string): string {
  return join(paths.ledgerDir, `${sanitizeSession(session)}.jsonl`);
}

export function headFile(paths: StorePaths, session: string): string {
  return join(paths.headsDir, `${sanitizeSession(session)}.json`);
}

/** Session ids come from external payloads — never let them traverse paths. */
export function sanitizeSession(session: string): string {
  const cleaned = session.replace(/[^A-Za-z0-9._-]/g, '_');
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw new NightWatchError('INVALID_PAYLOAD', `unusable session id: ${JSON.stringify(session)}`);
  }
  return cleaned;
}
