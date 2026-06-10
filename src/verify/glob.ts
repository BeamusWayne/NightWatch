/**
 * Minimal glob matching for scope patterns. Supports `**` (any depth), `*`
 * (within a segment) and `?`. Deliberately tiny instead of a dependency:
 * scope patterns are simple prefixes like `src/**` in practice, and the
 * matcher being auditable matters more than exotic syntax.
 */

export function globToRegExp(pattern: string): RegExp {
  let out = '^';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        const next = pattern[i + 2];
        if (next === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else if (ch !== undefined && /[.+^${}()|[\]\\]/.test(ch)) {
      out += `\\${ch}`;
    } else if (ch !== undefined) {
      out += ch;
    }
  }
  return new RegExp(`${out}$`);
}

export function matchesAny(path: string, patterns: readonly string[]): boolean {
  const normalized = path.replace(/^\.\//, '');
  return patterns.some(pattern => globToRegExp(pattern).test(normalized));
}
