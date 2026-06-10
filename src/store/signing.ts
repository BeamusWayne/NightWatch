import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { KeyPairPem } from '../core/signing.js';
import { NightWatchError } from '../util/errors.js';
import type { StorePaths } from './paths.js';

/**
 * Key resolution for ledger signing. Presence of `.nightwatch/keys/signing.pem`
 * is the whole configuration: no key file, no signing — which is what keeps
 * stores created before this feature working untouched.
 */

const PRIVATE_KEY_FILE = 'signing.pem';
const PUBLIC_KEY_FILE = 'signing.pub.pem';

export interface SigningKeyFiles {
  readonly privateKeyPath: string;
  readonly publicKeyPath: string;
}

export interface SigningConfig extends SigningKeyFiles {
  readonly privateKeyPem?: string;
  readonly publicKeyPem?: string;
}

export function signingKeyFiles(paths: StorePaths): SigningKeyFiles {
  return {
    privateKeyPath: join(paths.keysDir, PRIVATE_KEY_FILE),
    publicKeyPath: join(paths.keysDir, PUBLIC_KEY_FILE),
  };
}

export function readSigningConfig(paths: StorePaths): SigningConfig {
  const files = signingKeyFiles(paths);
  const privateKeyPem = readPem(files.privateKeyPath);
  const publicKeyPem = readPem(files.publicKeyPath);
  return {
    ...files,
    ...(privateKeyPem !== undefined ? { privateKeyPem } : {}),
    ...(publicKeyPem !== undefined ? { publicKeyPem } : {}),
  };
}

export function writeSigningKeys(
  paths: StorePaths,
  pair: KeyPairPem,
  options: { force?: boolean } = {},
): SigningKeyFiles {
  const files = signingKeyFiles(paths);
  const existing = [files.privateKeyPath, files.publicKeyPath].filter(existsSync);
  if (existing.length > 0 && options.force !== true) {
    throw new NightWatchError('SIGNING_FAILED', `key(s) already exist, re-run with --force to overwrite: ${existing.join(', ')}`, {
      existing,
    });
  }
  mkdirSync(paths.keysDir, { recursive: true });
  // Remove first: writeFileSync applies `mode` only when creating the file,
  // so a --force overwrite must not inherit looser permissions.
  rmSync(files.privateKeyPath, { force: true });
  writeFileSync(files.privateKeyPath, pair.privateKeyPem, { encoding: 'utf8', mode: 0o600 });
  writeFileSync(files.publicKeyPath, pair.publicKeyPem, 'utf8');
  return files;
}

/**
 * A present-but-empty key file is an error, never "signing off": silently
 * downgrading to unsigned appends would let a tamperer disable signing by
 * blanking one file.
 */
function readPem(file: string): string | undefined {
  if (!existsSync(file)) return undefined;
  const content = readFileSync(file, 'utf8');
  if (content.trim().length === 0) {
    throw new NightWatchError('SIGNING_FAILED', `signing key file is empty: ${file}`);
  }
  return content;
}
