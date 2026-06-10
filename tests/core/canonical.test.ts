import { describe, expect, it } from 'vitest';
import { canonicalStringify } from '../../src/core/canonical.js';
import { NightWatchError } from '../../src/util/errors.js';

describe('canonicalStringify', () => {
  it('sorts object keys recursively', () => {
    expect(canonicalStringify({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('is insensitive to key insertion order', () => {
    const one = canonicalStringify({ x: 1, y: [{ b: 2, a: 1 }] });
    const two = canonicalStringify({ y: [{ a: 1, b: 2 }], x: 1 });
    expect(one).toBe(two);
  });

  it('preserves array order', () => {
    expect(canonicalStringify([3, 1, 2])).toBe('[3,1,2]');
  });

  it('drops undefined object members and nullifies undefined array items', () => {
    expect(canonicalStringify({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalStringify([undefined, 1])).toBe('[null,1]');
  });

  it('escapes strings exactly like JSON', () => {
    expect(canonicalStringify({ s: 'a"b\n' })).toBe('{"s":"a\\"b\\n"}');
  });

  it('rejects non-finite numbers', () => {
    expect(() => canonicalStringify({ n: Number.NaN })).toThrow(NightWatchError);
    expect(() => canonicalStringify({ n: Infinity })).toThrow(NightWatchError);
  });

  it('rejects circular references', () => {
    const a: Record<string, unknown> = {};
    a['self'] = a;
    expect(() => canonicalStringify(a)).toThrow(NightWatchError);
  });

  it('allows repeated (non-circular) references to the same object', () => {
    const shared = { k: 1 };
    expect(canonicalStringify({ a: shared, b: shared })).toBe('{"a":{"k":1},"b":{"k":1}}');
  });
});
