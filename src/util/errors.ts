/** Error taxonomy: callers branch on `code`, never on message text. */
export type NightWatchErrorCode =
  | 'CANONICALIZE_FAILED'
  | 'LEDGER_CORRUPT'
  | 'LEDGER_LOCKED'
  | 'STORE_NOT_FOUND'
  | 'GIT_UNAVAILABLE'
  | 'CHECKPOINT_FAILED'
  | 'INVALID_PAYLOAD'
  | 'SETTINGS_MERGE_FAILED'
  | 'SIGNING_FAILED'
  | 'VERIFY_FAILED';

export class NightWatchError extends Error {
  readonly code: NightWatchErrorCode;
  readonly detail: Readonly<Record<string, unknown>>;

  constructor(code: NightWatchErrorCode, message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.name = 'NightWatchError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

export function isNightWatchError(value: unknown): value is NightWatchError {
  return value instanceof NightWatchError;
}

/** Normalize any thrown value into a printable one-line message. */
export function describeError(value: unknown): string {
  if (isNightWatchError(value)) return `[${value.code}] ${value.message}`;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  return String(value);
}
