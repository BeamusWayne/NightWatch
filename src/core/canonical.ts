import { NightWatchError } from '../util/errors.js';

/**
 * Deterministic JSON serialization: object keys sorted recursively, no
 * whitespace. Two structurally equal values always produce identical bytes,
 * which is what makes ledger hashes reproducible across processes and
 * platforms. `undefined` members are dropped (like JSON.stringify); cycles
 * and non-finite numbers are hard errors because silently coercing them
 * would make a hash cover different data than the reader sees.
 */
export function canonicalStringify(value: unknown): string {
  return stringifyValue(value, new Set());
}

function stringifyValue(value: unknown, seen: Set<object>): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new NightWatchError('CANONICALIZE_FAILED', `non-finite number: ${value}`);
      }
      return JSON.stringify(value);
    case 'object':
      return stringifyObject(value as object, seen);
    default:
      throw new NightWatchError('CANONICALIZE_FAILED', `unsupported type: ${typeof value}`);
  }
}

function stringifyObject(value: object, seen: Set<object>): string {
  if (seen.has(value)) {
    throw new NightWatchError('CANONICALIZE_FAILED', 'circular reference');
  }
  const nextSeen = new Set(seen).add(value);

  if (Array.isArray(value)) {
    const items = value.map(item => (item === undefined ? 'null' : stringifyValue(item, nextSeen)));
    return `[${items.join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stringifyValue(v, nextSeen)}`);
  return `{${entries.join(',')}}`;
}
