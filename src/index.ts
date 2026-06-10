/** Public API surface. The CLI is a thin wrapper over these exports. */

export { canonicalStringify } from './core/canonical.js';
export { GENESIS, digestValue, sha256Hex } from './core/hash.js';
export {
  ACTION_CLASSES,
  claimSchema,
  computeRecordHash,
  ledgerRecordSchema,
  recordHashValid,
  sealRecord,
} from './core/record.js';
export type { ActionClass, Claim, LedgerRecord, UnhashedRecord } from './core/record.js';
export { classifyBashCommand, classifyTool, targetOf } from './core/classify.js';
export { extractClaims, redactSecrets } from './core/claims.js';

export { appendRecord, parseLedgerLines, readLedger, verifyChain, loadHead } from './store/ledger.js';
export type { ChainCheck, LedgerHead } from './store/ledger.js';
export { ensureStore, findProjectRoot, ledgerFile, storePathsAt } from './store/paths.js';
export type { StorePaths } from './store/paths.js';
export { readMeta, updateMeta, writeMeta } from './store/meta.js';
export type { ProjectMeta } from './store/meta.js';

export { buildRecordFromPayload, ingest } from './hooks/ingest.js';
export type { IngestContext, IngestResult } from './hooks/ingest.js';
export { hookPayloadSchema, parseHookPayload, responseText } from './hooks/payloads.js';
export type { HookPayload } from './hooks/payloads.js';
export { HOOK_COMMAND, installHooks } from './hooks/install.js';
export type { InstallResult } from './hooks/install.js';

export { createCheckpoint, listCheckpoints, restoreCommand } from './checkpoint/checkpoints.js';
export type { Checkpoint, CheckpointOutcome } from './checkpoint/checkpoints.js';

export { globToRegExp, matchesAny } from './verify/glob.js';
export { analyzeScope, collectClaimedPaths } from './verify/scope.js';
export type { ScopeReport } from './verify/scope.js';
export { collectTestClaims, verifyTestClaims } from './verify/tests.js';
export type { TestClaimStatus, TestClaimVerification } from './verify/tests.js';

export { buildDebrief } from './debrief/report.js';
export type { DebriefReport } from './debrief/report.js';
export { buildTimeline, spanHours } from './debrief/timeline.js';
export type { Phase } from './debrief/timeline.js';
export { countFindings, renderMarkdown, renderTerminal } from './debrief/render.js';
export type { Lang } from './debrief/i18n.js';

export { runDemo } from './demo.js';
export type { DemoResult } from './demo.js';

export { NightWatchError, describeError, isNightWatchError } from './util/errors.js';
export type { NightWatchErrorCode } from './util/errors.js';
