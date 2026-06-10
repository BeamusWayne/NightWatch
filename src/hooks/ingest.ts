import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { classifyTool, targetOf } from '../core/classify.js';
import { extractClaims, redactSecrets } from '../core/claims.js';
import type { Claim } from '../core/record.js';
import { digestValue } from '../core/hash.js';
import type { LedgerRecord, UnhashedRecord } from '../core/record.js';
import { appendRecord } from '../store/ledger.js';
import { ensureStore, storePathsAt } from '../store/paths.js';
import type { StorePaths } from '../store/paths.js';
import { describeError } from '../util/errors.js';
import { responseText } from './payloads.js';
import type { HookPayload } from './payloads.js';

/**
 * Hook ingestion. Two invariants dominate this module:
 *
 * 1. FAIL-OPEN — a recorder must never break the session it observes. The
 *    public entry point catches everything, spills what it could not append,
 *    and reports success to the harness.
 * 2. MINIMAL DATA — the ledger stores digests and short summaries, not full
 *    tool payloads. The digest still pins the transcript: anyone holding the
 *    transcript can recompute digests and prove it matches this ledger.
 */

export interface IngestContext {
  readonly now: () => Date;
  readonly harness: string;
  /** Store root for claim relativization; defaults to the payload cwd. */
  readonly root?: string;
}

const DEFAULT_CONTEXT: IngestContext = { now: () => new Date(), harness: 'claude-code' };

type EventKind = LedgerRecord['event'];

const EVENT_BY_HOOK: Readonly<Record<string, EventKind>> = Object.freeze({
  sessionstart: 'session_start',
  userpromptsubmit: 'prompt',
  posttooluse: 'tool_use',
  stop: 'stop',
  subagentstop: 'stop',
  sessionend: 'session_end',
});

/** Pure: payload → unsealed record fields (no seq/prev, the store assigns those). */
export function buildRecordFromPayload(
  payload: HookPayload,
  context: IngestContext = DEFAULT_CONTEXT,
): Omit<UnhashedRecord, 'seq' | 'prev'> | undefined {
  const event = EVENT_BY_HOOK[payload.hook_event_name.toLowerCase()];
  if (!event) return undefined;

  const base = {
    v: 1 as const,
    ts: context.now().toISOString(),
    session: payload.session_id,
    agent: { harness: context.harness, ...(payload.model ? { model: payload.model } : {}) },
    event,
  };

  if (event === 'tool_use') {
    const tool = payload.tool_name ?? 'unknown';
    const input = payload.tool_input ?? {};
    const output = responseText(payload.tool_response);
    // Relativize claim paths at WRITE time: receipts get verified on other
    // machines (CI is the whole point of attest), where the recording
    // machine's absolute paths are meaningless. Found by the selftest
    // refusing the archived run on a GitHub runner.
    const claims = relativizeClaims(extractClaims(tool, input, output), context.root ?? payload.cwd);
    const target = targetOf(tool, input);
    return {
      ...base,
      action: {
        tool,
        class: classifyTool(tool, input),
        input_digest: digestValue(input),
        summary: redactSecrets(target ?? '').slice(0, 160),
      },
      outcome: {
        status: outputLooksFailed(output) ? 'error' : 'ok',
        output_digest: digestValue(output),
      },
      ...(claims.length > 0 ? { claims: [...claims] } : {}),
    };
  }

  if (event === 'prompt') {
    const prompt = payload.prompt ?? '';
    return {
      ...base,
      meta: { prompt_digest: digestValue(prompt), prompt_preview: redactSecrets(prompt).slice(0, 240) },
    };
  }

  return { ...base, ...(payload.source ? { meta: { source: payload.source } } : {}) };
}

export interface IngestResult {
  readonly status: 'appended' | 'skipped' | 'spilled';
  readonly seq?: number;
  readonly error?: string;
}

/** Side-effecting entry point used by `nightwatch hook`. Never throws. */
export async function ingest(
  payload: HookPayload,
  projectRoot: string,
  context: IngestContext = DEFAULT_CONTEXT,
): Promise<IngestResult> {
  const paths = storePathsAt(projectRoot);
  try {
    ensureStore(paths);
    const record = buildRecordFromPayload(payload, context);
    if (!record) return { status: 'skipped' };
    const sealed = await appendRecord(paths, { record });
    return { status: 'appended', seq: sealed.seq };
  } catch (error) {
    const message = describeError(error);
    spill(paths, payload, message);
    return { status: 'spilled', error: message };
  }
}

/** A dropped event in a trust tool is worse than a noisy one: park it on disk. */
function spill(paths: StorePaths, payload: HookPayload, reason: string): void {
  try {
    const name = `${Date.now()}-${randomBytes(4).toString('hex')}.json`;
    writeFileSync(join(paths.spillDir, name), JSON.stringify({ reason, payload }), 'utf8');
    appendFileSync(paths.errorLog, `${new Date().toISOString()} spill ${name}: ${reason}\n`, 'utf8');
  } catch {
    // Even spilling failed (e.g. read-only disk). Nothing left to do without
    // risking the session — fail-open means silence here, by design.
  }
}

function outputLooksFailed(output: string): boolean {
  return /^(?:Error|Exit code [1-9])/m.test(output.slice(0, 2000));
}

function relativizeClaims(claims: readonly Claim[], cwd: string | undefined): readonly Claim[] {
  if (!cwd) return claims;
  const prefix = cwd.endsWith('/') ? cwd : `${cwd}/`;
  return claims.map(claim =>
    claim.type === 'file_change' && claim.path.startsWith(prefix)
      ? { ...claim, path: claim.path.slice(prefix.length) }
      : claim,
  );
}
