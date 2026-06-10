import { describe, expect, it } from 'vitest';
import { classifyBashCommand, classifyTool } from '../../src/core/classify.js';
import { extractClaims, redactSecrets } from '../../src/core/claims.js';

describe('classifyTool', () => {
  it('maps structured tools to classes', () => {
    expect(classifyTool('Read', {})).toBe('read');
    expect(classifyTool('Edit', {})).toBe('write');
    expect(classifyTool('WebFetch', {})).toBe('net');
    expect(classifyTool('Agent', {})).toBe('agent');
    expect(classifyTool('mcp__github__create_issue', {})).toBe('net');
    expect(classifyTool('SomethingNew', {})).toBe('other');
  });

  it('sniffs bash commands', () => {
    expect(classifyBashCommand('git commit -m "x"')).toBe('vcs');
    expect(classifyBashCommand('npm test && git push origin main')).toBe('vcs');
    expect(classifyBashCommand('curl https://example.com')).toBe('net');
    expect(classifyBashCommand('echo hi > out.txt')).toBe('write');
    expect(classifyBashCommand('sed -i "" s/a/b/ file.txt')).toBe('write');
    expect(classifyBashCommand('ls -la')).toBe('exec');
  });
});

describe('extractClaims', () => {
  it('extracts file_change from structured edit tools', () => {
    expect(extractClaims('Edit', { file_path: 'src/a.ts' }, '')).toEqual([
      { type: 'file_change', path: 'src/a.ts', via: 'Edit' },
    ]);
  });

  it('extracts a passing test_run claim', () => {
    const claims = extractClaims('Bash', { command: 'npx vitest run' }, 'Tests  7 passed (7)');
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ type: 'test_run', outcome: 'ok' });
  });

  it('extracts a failing test_run claim', () => {
    const claims = extractClaims('Bash', { command: 'pytest -q' }, '2 failed, 5 passed');
    expect(claims[0]).toMatchObject({ type: 'test_run', outcome: 'failed' });
  });

  it('treats "0 failed" as a pass', () => {
    const claims = extractClaims('Bash', { command: 'go test ./...' }, 'ok  pkg  0.2s — 0 failed, 12 passed');
    expect(claims[0]).toMatchObject({ type: 'test_run', outcome: 'ok' });
  });

  it('extracts git ops and shell-side writes', () => {
    expect(extractClaims('Bash', { command: 'git commit -am x' }, '')[0]).toMatchObject({ type: 'git_op', op: 'commit' });
    expect(extractClaims('Bash', { command: 'echo a >> notes.md' }, '')[0]).toMatchObject({ type: 'file_change', via: 'Bash' });
  });

  it('ignores read-only bash', () => {
    expect(extractClaims('Bash', { command: 'ls src' }, '')).toEqual([]);
  });

  it('redacts credential-shaped strings before persisting', () => {
    expect(redactSecrets('export KEY=sk-abc12345678901234567890')).not.toContain('sk-abc');
    expect(redactSecrets('Authorization: Bearer abcdef123456789012')).not.toContain('abcdef');
    const claims = extractClaims('Bash', { command: 'API_KEY=ghp_0123456789abcdef npm test' }, '1 passed');
    expect(JSON.stringify(claims)).not.toContain('ghp_0123456789abcdef');
  });
});
