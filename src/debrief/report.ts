import { existsSync, readdirSync } from 'node:fs';
import type { Checkpoint } from '../checkpoint/checkpoints.js';
import { listCheckpoints } from '../checkpoint/checkpoints.js';
import { ACTION_CLASSES } from '../core/record.js';
import type { ActionClass, LedgerRecord } from '../core/record.js';
import { verifyLedgerSignatures } from '../core/signing.js';
import type { SignatureCheck } from '../core/signing.js';
import { loadHead, readLedger, verifyChain } from '../store/ledger.js';
import type { ChainCheck } from '../store/ledger.js';
import { readMeta } from '../store/meta.js';
import type { StorePaths } from '../store/paths.js';
import { readSigningConfig } from '../store/signing.js';
import { realExec, realShellExec } from '../util/exec.js';
import type { ExecFn } from '../util/exec.js';
import { analyzeScope } from '../verify/scope.js';
import type { ScopeReport } from '../verify/scope.js';
import { verifyTestClaims } from '../verify/tests.js';
import type { TestClaimVerification } from '../verify/tests.js';
import { buildTimeline, spanHours } from './timeline.js';
import type { Phase } from './timeline.js';

/** Everything a renderer needs; assembling it does all the verification work. */
export interface DebriefReport {
  readonly session: string;
  readonly generatedAt: string;
  readonly model?: string;
  readonly goal?: string;
  readonly promptPreview?: string;
  readonly spanHours?: number;
  readonly stats: {
    readonly events: number;
    readonly toolUses: number;
    readonly byClass: Readonly<Record<ActionClass, number>>;
  };
  readonly chain: ChainCheck;
  /** Present only when the store has a public signing key configured. */
  readonly signatures?: SignatureCheck;
  readonly phases: readonly Phase[];
  readonly testClaims: readonly TestClaimVerification[];
  readonly gitOps: ReadonlyArray<{ seq: number; op: string; command: string }>;
  readonly scope: ScopeReport;
  readonly checkpoints: readonly Checkpoint[];
  readonly spilledEvents: number;
}

export interface BuildDebriefOptions {
  readonly session: string;
  readonly projectRoot: string;
  readonly rerunTests: boolean;
  readonly rerunLastN?: number;
  readonly exec?: ExecFn;
  readonly shellExec?: ExecFn;
  readonly now?: () => Date;
}

export function buildDebrief(paths: StorePaths, options: BuildDebriefOptions): DebriefReport {
  const records = readLedger(paths, options.session);
  const head = loadHead(paths, options.session);
  const chain = verifyChain(records, head);
  const signatures = signatureCheckOf(paths, records);
  const meta = readMeta(paths);
  const checkpoints = listCheckpoints(paths, options.session);
  const firstCheckpoint = checkpoints[0];

  const scope = analyzeScope(records, meta.scope, options.projectRoot, firstCheckpoint, options.exec ?? realExec);
  const testClaims = verifyTestClaims(records, {
    rerun: options.rerunTests,
    cwd: options.projectRoot,
    exec: options.shellExec ?? realShellExec,
    ...(options.rerunLastN !== undefined ? { lastN: options.rerunLastN } : {}),
  });

  const model = modelOf(records);
  const promptPreview = promptPreviewOf(records);
  const span = spanHours(records);

  return {
    session: options.session,
    generatedAt: (options.now ? options.now() : new Date()).toISOString(),
    ...(model !== undefined ? { model } : {}),
    ...(meta.goal ? { goal: meta.goal } : {}),
    ...(promptPreview !== undefined ? { promptPreview } : {}),
    ...(span !== undefined ? { spanHours: span } : {}),
    stats: statsOf(records),
    chain,
    ...(signatures !== undefined ? { signatures } : {}),
    phases: buildTimeline(records),
    testClaims,
    gitOps: gitOpsOf(records),
    scope,
    checkpoints,
    spilledEvents: countSpilled(paths),
  };
}

/** Signature verification runs only for keyed stores; keyless reports omit it. */
function signatureCheckOf(paths: StorePaths, records: readonly LedgerRecord[]): SignatureCheck | undefined {
  const signing = readSigningConfig(paths);
  return signing.publicKeyPem !== undefined ? verifyLedgerSignatures(records, signing.publicKeyPem) : undefined;
}

function statsOf(records: readonly LedgerRecord[]): DebriefReport['stats'] {
  const byClass = Object.fromEntries(ACTION_CLASSES.map(cls => [cls, 0])) as Record<ActionClass, number>;
  let toolUses = 0;
  for (const record of records) {
    if (record.event === 'tool_use' && record.action) {
      toolUses += 1;
      byClass[record.action.class] += 1;
    }
  }
  return { events: records.length, toolUses, byClass };
}

function modelOf(records: readonly LedgerRecord[]): string | undefined {
  for (const record of records) {
    if (record.agent.model) return record.agent.model;
  }
  return undefined;
}

function promptPreviewOf(records: readonly LedgerRecord[]): string | undefined {
  for (const record of records) {
    if (record.event === 'prompt' && record.meta) {
      const preview = record.meta['prompt_preview'];
      if (typeof preview === 'string' && preview.length > 0) return preview;
    }
  }
  return undefined;
}

function gitOpsOf(records: readonly LedgerRecord[]): ReadonlyArray<{ seq: number; op: string; command: string }> {
  const ops: Array<{ seq: number; op: string; command: string }> = [];
  for (const record of records) {
    for (const claim of record.claims ?? []) {
      if (claim.type === 'git_op') ops.push({ seq: record.seq, op: claim.op, command: claim.command });
    }
  }
  return ops;
}

function countSpilled(paths: StorePaths): number {
  if (!existsSync(paths.spillDir)) return 0;
  try {
    return readdirSync(paths.spillDir).filter(name => name.endsWith('.json')).length;
  } catch {
    return 0;
  }
}
