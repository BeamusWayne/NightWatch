#!/usr/bin/env node
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { createCheckpoint, isAutoCheckpointEvent, listCheckpoints, restoreCommand } from './checkpoint/checkpoints.js';
import { generateKeyPair, verifyLedgerSignatures } from './core/signing.js';
import { renderMarkdown, renderTerminal } from './debrief/render.js';
import type { Lang } from './debrief/i18n.js';
import { buildDebrief } from './debrief/report.js';
import { runDemo } from './demo.js';
import { ingest } from './hooks/ingest.js';
import { installHooks } from './hooks/install.js';
import { parseHookPayload } from './hooks/payloads.js';
import { loadHead, readLedger, verifyChain } from './store/ledger.js';
import { readMeta, updateMeta } from './store/meta.js';
import { ensureStore, findProjectRoot, storePathsAt } from './store/paths.js';
import type { StorePaths } from './store/paths.js';
import { readSigningConfig, writeSigningKeys } from './store/signing.js';
import { describeError } from './util/errors.js';
import { realExec } from './util/exec.js';

const program = new Command();
program.name('nightwatch').description('Black box recorder and morning debrief for overnight AI agent runs.');

program
  .command('init')
  .description('install Claude Code hooks and create the .nightwatch/ store in this project')
  .option('--goal <text>', 'declared goal for upcoming runs')
  .option('--scope <globs...>', 'path globs the agent is expected to stay inside (e.g. "src/**")')
  .action((options: { goal?: string; scope?: string[] }) => {
    const root = process.cwd();
    const paths = storePathsAt(root);
    ensureStore(paths);
    ensureGitignoreEntry(root);
    updateMeta(paths, {
      ...(options.goal !== undefined ? { goal: options.goal } : {}),
      ...(options.scope !== undefined ? { scope: options.scope } : {}),
      createdAt: new Date().toISOString(),
    });
    const result = installHooks(root);
    console.log(`store:    ${paths.root}`);
    console.log(`settings: ${result.settingsPath}`);
    if (result.added.length > 0) console.log(`hooks added: ${result.added.join(', ')}`);
    if (result.alreadyPresent.length > 0) console.log(`already installed: ${result.alreadyPresent.join(', ')}`);
    console.log('\nNightWatch is recording. Tomorrow morning: `nightwatch debrief`');
  });

program
  .command('hook')
  .description('(used by Claude Code hooks) ingest one event from stdin; always exits 0')
  .action(async () => {
    // FAIL-OPEN: this command must never break the host session. Any failure
    // is recorded in .nightwatch/errors.log by ingest(); we still exit 0.
    try {
      const payload = parseHookPayload(readFileSync(0, 'utf8'));
      const root = payload.cwd ?? process.cwd();
      const result = await ingest(payload, root);
      if (result.status === 'appended' && isAutoCheckpointEvent(payload.hook_event_name)) {
        createCheckpoint(
          storePathsAt(root),
          root,
          payload.session_id,
          `auto checkpoint (${payload.hook_event_name.toLowerCase()}, seq ${result.seq})`,
        );
      }
    } catch {
      // Unparseable payload: nothing safe to persist; stay silent by design.
    }
    process.exit(0);
  });

program
  .command('status')
  .description('summarize the latest session ledger and chain integrity')
  .option('--session <id>', 'session id (default: most recent)')
  .action((options: { session?: string }) => {
    const { paths } = locate();
    const session = resolveSession(paths, options.session);
    const records = readLedger(paths, session);
    const chain = verifyChain(records, loadHead(paths, session));
    const meta = readMeta(paths);
    console.log(`session:     ${session}`);
    console.log(`records:     ${records.length}`);
    console.log(`chain:       ${chain.ok ? 'intact ✅' : `BROKEN 🚨 (${chain.reason ?? 'unknown'})`}`);
    console.log(`checkpoints: ${listCheckpoints(paths, session).length}`);
    if (meta.goal) console.log(`goal:        ${meta.goal}`);
    if (meta.scope.length > 0) console.log(`scope:       ${meta.scope.join(', ')}`);
  });

program
  .command('checkpoint')
  .description('snapshot the working tree (plumbing only: HEAD, index and worktree untouched)')
  .option('-m, --message <note>', 'checkpoint note')
  .option('--session <id>', 'session id (default: most recent)')
  .action((options: { message?: string; session?: string }) => {
    const { paths, root } = locate();
    const session = resolveSession(paths, options.session);
    const outcome = createCheckpoint(paths, root, session, options.message);
    if (outcome.created && outcome.checkpoint) {
      console.log(`checkpoint #${outcome.checkpoint.seq} → ${outcome.checkpoint.commit.slice(0, 12)}`);
    } else {
      console.log(`no checkpoint created: ${outcome.reason ?? 'unknown'}`);
    }
  });

program
  .command('rollback')
  .description('show (or apply) the restore command for a recorded checkpoint')
  .argument('<seq>', 'checkpoint sequence number')
  .option('--session <id>', 'session id (default: most recent)')
  .option('--apply', 'actually run the restore (defaults to printing it)')
  .action((seqArg: string, options: { session?: string; apply?: boolean }) => {
    const { paths, root } = locate();
    const session = resolveSession(paths, options.session);
    const checkpoint = listCheckpoints(paths, session).find(cp => cp.seq === Number(seqArg));
    if (!checkpoint) return fail(`no checkpoint #${seqArg} for session ${session}`);
    const command = restoreCommand(checkpoint);
    if (!options.apply) {
      console.log(`dry run — to restore, run:\n  ${command}\n(or re-run with --apply; untracked files created later are NOT removed)`);
      return;
    }
    const result = realExec('git', ['restore', `--source=${checkpoint.commit}`, '--worktree', '--', '.'], { cwd: root });
    if (result.status !== 0) return fail(`restore failed: ${result.stderr.trim()}`);
    console.log(`restored worktree to checkpoint #${checkpoint.seq} (${checkpoint.commit.slice(0, 12)})`);
  });

program
  .command('debrief')
  .description('the morning report: timeline, verified claims, scope check, chain integrity')
  .option('--session <id>', 'session id (default: most recent)')
  .option('--lang <lang>', 'report language: en | zh', 'en')
  .option('--md <file>', 'also write the markdown report to a file')
  .option('--verify', 're-run recorded test commands to verify pass claims', false)
  .option('--last-n <n>', 'with --verify, only re-run the last N test claims')
  .option('--no-color', 'disable ANSI colors')
  .action((options: { session?: string; lang: string; md?: string; verify: boolean; lastN?: string; color: boolean }) => {
    const { paths, root } = locate();
    const session = resolveSession(paths, options.session);
    const lang: Lang = options.lang === 'zh' ? 'zh' : 'en';
    const report = buildDebrief(paths, {
      session,
      projectRoot: root,
      rerunTests: options.verify,
      ...(options.lastN !== undefined ? { rerunLastN: Number(options.lastN) } : {}),
    });
    console.log(renderTerminal(report, lang, options.color && process.stdout.isTTY === true));
    if (options.md) {
      writeFileSync(options.md, renderMarkdown(report, lang), 'utf8');
      console.log(`\nmarkdown report → ${options.md}`);
    }
  });

program
  .command('keygen')
  .description('generate a P-256 keypair in .nightwatch/keys/ so new ledger records are signed')
  .option('--force', 'overwrite an existing keypair', false)
  .action((options: { force: boolean }) => {
    const { paths } = locate();
    const written = writeSigningKeys(paths, generateKeyPair(), { force: options.force });
    console.log(`public key: ${written.publicKeyPath}`);
    console.log('records are signed from the next append on; older records stay valid unsigned.');
    console.log('the private key never leaves .nightwatch/ — do not commit or share it.');
  });

program
  .command('verify')
  .description('fast integrity pass: chain + head sidecar + signatures (when a key exists), no test re-runs')
  .option('--session <id>', 'session id (default: most recent)')
  .action((options: { session?: string }) => {
    const { paths } = locate();
    const session = resolveSession(paths, options.session);
    const records = readLedger(paths, session);
    const chain = verifyChain(records, loadHead(paths, session));
    if (!chain.ok) {
      return fail(`chain check FAILED: ${chain.reason ?? 'unknown'}${chain.brokenAtSeq !== undefined ? ` (seq ${chain.brokenAtSeq})` : ''}`);
    }
    console.log(`chain intact: ${chain.length} records ✅`);
    const signing = readSigningConfig(paths);
    if (signing.publicKeyPem === undefined) return;
    const sigs = verifyLedgerSignatures(records, signing.publicKeyPem);
    if (!sigs.ok) {
      return fail(`signature check FAILED: ${sigs.invalidSeqs.length} invalid signature(s) (seq ${sigs.invalidSeqs.join(', ')})`);
    }
    console.log(`signed: ${sigs.verified}/${sigs.signed} verified ✅`);
    if (sigs.unsigned > 0) console.log(`warning: ${sigs.unsigned} unsigned record(s) predate the signing key`);
  });

program
  .command('demo')
  .description('replay a bundled synthetic overnight run and print its debrief')
  .option('--lang <lang>', 'report language: en | zh', 'en')
  .action(async (options: { lang: string }) => {
    const fixture = fileURLToPath(new URL('../fixtures/demo-session.json', import.meta.url));
    const { projectRoot, report } = await runDemo(fixture);
    const lang: Lang = options.lang === 'zh' ? 'zh' : 'en';
    console.log(renderTerminal(report, lang, process.stdout.isTTY === true));
    console.log(`\n(demo project with its .nightwatch/ store: ${projectRoot})`);
  });

function locate(): { paths: StorePaths; root: string } {
  const root = findProjectRoot(process.cwd());
  return { paths: storePathsAt(root), root };
}

/** The store must never show up in the project's own diffs or checkpoints. */
function ensureGitignoreEntry(root: string): void {
  const gitignore = join(root, '.gitignore');
  try {
    const current = readFileSync(gitignore, 'utf8');
    if (current.split('\n').some(line => line.trim() === '.nightwatch/' || line.trim() === '.nightwatch')) return;
    writeFileSync(gitignore, `${current}${current.endsWith('\n') || current === '' ? '' : '\n'}.nightwatch/\n`, 'utf8');
  } catch {
    writeFileSync(gitignore, '.nightwatch/\n', 'utf8');
  }
}

function resolveSession(paths: StorePaths, explicit?: string): string {
  if (explicit) return explicit;
  const entries = readdirSync(paths.ledgerDir)
    .filter(name => name.endsWith('.jsonl'))
    .map(name => ({ name: name.replace(/\.jsonl$/, ''), mtime: statSync(join(paths.ledgerDir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  const latest = entries[0];
  if (!latest) return fail('no sessions recorded yet — run `nightwatch init` and start an agent session');
  return latest.name;
}

function fail(message: string): never {
  console.error(`nightwatch: ${message}`);
  process.exit(1);
}

program.parseAsync(process.argv).catch(error => {
  fail(describeError(error));
});
