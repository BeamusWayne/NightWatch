import type { Claim } from './record.js';
import { classifyTool, commandText } from './classify.js';

/**
 * Extract verifiable claims from a tool event. A claim is a statement the
 * agent's transcript implies ("I ran the tests and they passed", "I changed
 * this file") that the debrief can later check against ground truth.
 * Extraction is intentionally conservative: a missed claim costs coverage,
 * a fabricated one costs trust in the tool itself.
 */

const TEST_CMD_RE =
  /\b(?:vitest|jest|mocha|pytest|tox|go\s+test|cargo\s+(?:test|nextest)|bun\s+test|phpunit|rspec|ctest|gradle(?:w)?\s+test|mvn\s+test|(?:npm|pnpm|yarn)\s+(?:run\s+)?test)\b/;
const GIT_OP_RE = /(?:^|[;&|]\s*)git\s+(commit|push|merge|rebase|reset|revert|tag)\b/;

const PASS_RE = /(\d+)\s*(?:tests?\s+)?(?:passed|passing|pass\b|ok\b)|all tests passed|✓|PASSED/i;
const FAIL_RE = /(\d+)\s*(?:tests?\s+)?(?:failed|failing)|FAILED|✗|ERROR:|Traceback \(most recent call last\)/;

const SECRET_RE =
  /\b(sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{8,}|gho_[A-Za-z0-9]{8,}|AKIA[A-Z0-9]{12,}|xox[baprs]-[A-Za-z0-9-]{8,}|Bearer\s+[A-Za-z0-9._-]{12,})/g;

/** Replace credential-shaped substrings before anything is persisted. */
export function redactSecrets(text: string): string {
  return text.replace(SECRET_RE, '[REDACTED]');
}

export function extractClaims(
  toolName: string,
  input: Readonly<Record<string, unknown>>,
  responseText: string,
): readonly Claim[] {
  const cls = classifyTool(toolName, input);
  const normalized = toolName.toLowerCase();

  if (normalized === 'write' || normalized === 'edit' || normalized === 'multiedit' || normalized === 'notebookedit') {
    const path = firstString(input, ['file_path', 'notebook_path', 'path']);
    return path ? [{ type: 'file_change', path, via: toolName }] : [];
  }

  if (normalized !== 'bash') return [];

  const command = redactSecrets(commandText(input));
  if (!command) return [];
  const claims: Claim[] = [];

  if (TEST_CMD_RE.test(command)) {
    claims.push({
      type: 'test_run',
      command,
      outcome: testOutcome(responseText),
      summary: testSummary(responseText),
    });
  }
  const gitMatch = GIT_OP_RE.exec(command);
  if (gitMatch && gitMatch[1]) {
    claims.push({ type: 'git_op', op: gitMatch[1], command });
  }
  if (claims.length === 0 && cls === 'write') {
    // Shell-side writes (redirections, sed -i, rm...) bypass the structured
    // edit tools; record the command itself so the scope check can compare
    // ledger claims against the git ground truth later.
    claims.push({ type: 'file_change', path: command.slice(0, 200), via: 'Bash' });
  }
  return claims;
}

function testOutcome(output: string): 'ok' | 'failed' | 'unknown' {
  const failed = FAIL_RE.test(output) && !/\b0 failed\b/i.test(output);
  if (failed) return 'failed';
  if (PASS_RE.test(output)) return 'ok';
  return 'unknown';
}

function testSummary(output: string): string {
  const lines = output.split('\n').filter(line => PASS_RE.test(line) || FAIL_RE.test(line));
  const last = lines[lines.length - 1];
  return redactSecrets((last ?? '').trim()).slice(0, 200);
}

function firstString(input: Readonly<Record<string, unknown>>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}
