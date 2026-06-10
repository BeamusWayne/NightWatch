import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * End-to-end pass over the BUILT binary (dist/cli.js): init → unsigned append
 * → keygen → signed append → verify → keygen refusal → key rotation breaking
 * old signatures. Skipped when dist/ is absent; run `npm run build` first to
 * exercise it locally.
 */

const CLI = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));

function cli(root: string, args: readonly string[], input?: string) {
  const result = spawnSync('node', [CLI, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
    ...(input !== undefined ? { input } : {}),
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

function toolPayload(root: string, tool: string, file: string): string {
  return JSON.stringify({
    hook_event_name: 'PostToolUse',
    session_id: 'smoke-1',
    cwd: root,
    tool_name: tool,
    tool_input: { file_path: file },
  });
}

describe.skipIf(!existsSync(CLI))('cli signing e2e (against dist/)', () => {
  it('covers keygen, signed appends, verify, refusal and rotation', () => {
    const root = mkdtempSync(join(tmpdir(), 'nw-cli-sign-'));

    expect(cli(root, ['init', '--goal', 'smoke']).status).toBe(0);
    expect(cli(root, ['hook'], toolPayload(root, 'Read', 'a.ts')).status).toBe(0);

    const keyless = cli(root, ['verify', '--session', 'smoke-1']);
    expect(keyless.status).toBe(0);
    expect(keyless.out).toContain('chain intact: 1 records');
    expect(keyless.out).not.toContain('signed:');

    const keygen = cli(root, ['keygen']);
    expect(keygen.status).toBe(0);
    expect(keygen.out).toContain(join('.nightwatch', 'keys', 'signing.pub.pem'));

    expect(cli(root, ['hook'], toolPayload(root, 'Edit', 'b.ts')).status).toBe(0);

    const keyed = cli(root, ['verify', '--session', 'smoke-1']);
    expect(keyed.status).toBe(0);
    expect(keyed.out).toContain('chain intact: 2 records');
    expect(keyed.out).toContain('signed: 1/1 verified');
    expect(keyed.out).toContain('warning: 1 unsigned record(s)');

    const refused = cli(root, ['keygen']);
    expect(refused.status).toBe(1);
    expect(refused.out).toContain('--force');

    // Rotating the key orphans earlier signatures — verify must fail loudly.
    expect(cli(root, ['keygen', '--force']).status).toBe(0);
    const rotated = cli(root, ['verify', '--session', 'smoke-1']);
    expect(rotated.status).toBe(1);
    expect(rotated.out).toContain('signature check FAILED');
    expect(rotated.out).toContain('seq 1');

    const debrief = cli(root, ['debrief', '--session', 'smoke-1']);
    expect(debrief.status).toBe(0);
    expect(debrief.out).toContain('SIGNATURE INVALID');

    const debriefZh = cli(root, ['debrief', '--session', 'smoke-1', '--lang', 'zh']);
    expect(debriefZh.status).toBe(0);
    expect(debriefZh.out).toContain('签名无效');
  });
});
