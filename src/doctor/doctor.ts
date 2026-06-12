import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installedAlfredHookEvents, installedHookEvents } from '../hooks/install.js';
import { loadHead, readLedger, verifyChain } from '../store/ledger.js';
import { STORE_DIRNAME, storePathsAt } from '../store/paths.js';
import { realExec } from '../util/exec.js';
import type { ExecFn } from '../util/exec.js';

/**
 * One-command self-check of the recording pipeline — the executable version
 * of the README's Troubleshooting section. Every check answers a question a
 * user would otherwise debug by hand the morning after a silent night.
 */

export type DoctorStatus = 'ok' | 'warn' | 'fail';

export interface DoctorCheck {
  readonly name: string;
  readonly status: DoctorStatus;
  readonly detail: string;
}

export function runDoctor(projectRoot: string, exec: ExecFn = realExec): readonly DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const paths = storePathsAt(projectRoot);

  const major = Number(process.versions.node.split('.')[0]);
  checks.push(
    major >= 20
      ? { name: 'node', status: 'ok', detail: `v${process.versions.node}` }
      : { name: 'node', status: 'fail', detail: `v${process.versions.node} — NightWatch needs Node >= 20` },
  );

  const git = exec('git', ['rev-parse', '--is-inside-work-tree'], { cwd: projectRoot });
  checks.push(
    git.status === 0
      ? { name: 'git', status: 'ok', detail: 'inside a work tree — checkpoints and scope ground truth available' }
      : { name: 'git', status: 'warn', detail: 'no git repo here — recording works; checkpoints and scope diffs degrade' },
  );

  // Either harness counts: a project records via Claude Code, Alfred, or both.
  const claudeEvents = installedHookEvents(projectRoot);
  const alfredEvents = installedAlfredHookEvents(projectRoot);
  const harnesses = [
    claudeEvents.length > 0 ? `claude-code (${claudeEvents.length} events)` : '',
    alfredEvents.length > 0 ? `alfred (${alfredEvents.length} events)` : '',
  ].filter(Boolean);
  const fullyInstalled = claudeEvents.length >= 5 || alfredEvents.length >= 5;
  checks.push(
    fullyInstalled
      ? { name: 'hooks', status: 'ok', detail: `installed — ${harnesses.join(' · ')}` }
      : harnesses.length > 0
        ? { name: 'hooks', status: 'warn', detail: `partial install (${harnesses.join(' · ')}) — re-run \`nightwatch init\`` }
        : { name: 'hooks', status: 'fail', detail: 'not installed — run `nightwatch init` (then START A NEW SESSION)' },
  );

  if (!existsSync(paths.root)) {
    checks.push({ name: 'store', status: 'warn', detail: `no ${STORE_DIRNAME}/ yet — run \`nightwatch init\`` });
    return checks;
  }

  checks.push(storeWritable(paths.root));
  checks.push(...ledgerChecks(paths, projectRoot));

  const spilled = existsSync(paths.spillDir) ? readdirSync(paths.spillDir).filter(f => f.endsWith('.json')).length : 0;
  checks.push(
    spilled === 0
      ? { name: 'spill', status: 'ok', detail: 'no spilled events' }
      : { name: 'spill', status: 'warn', detail: `${spilled} event(s) in ${STORE_DIRNAME}/spill/ — appended nothing, evidence parked` },
  );
  return checks;
}

function storeWritable(root: string): DoctorCheck {
  const probe = join(root, `.doctor-probe-${process.pid}`);
  try {
    writeFileSync(probe, 'probe', 'utf8');
    rmSync(probe, { force: true });
    return { name: 'store', status: 'ok', detail: 'store exists and is writable' };
  } catch (error) {
    return { name: 'store', status: 'fail', detail: `store not writable: ${String(error).slice(0, 120)}` };
  }
}

function ledgerChecks(paths: ReturnType<typeof storePathsAt>, _projectRoot: string): DoctorCheck[] {
  if (!existsSync(paths.ledgerDir)) return [{ name: 'ledger', status: 'warn', detail: 'no sessions recorded yet' }];
  const sessions = readdirSync(paths.ledgerDir).filter(f => f.endsWith('.jsonl'));
  if (sessions.length === 0) {
    return [{
      name: 'ledger',
      status: 'warn',
      detail: 'no sessions recorded yet — if an agent already ran, did it start AFTER `nightwatch init`?',
    }];
  }
  const latest = (sessions[sessions.length - 1] ?? '').replace(/\.jsonl$/, '');
  try {
    const records = readLedger(paths, latest);
    const chain = verifyChain(records, loadHead(paths, latest));
    return [
      chain.ok
        ? { name: 'ledger', status: 'ok', detail: `${sessions.length} session(s); latest \`${latest.slice(0, 8)}…\` chain intact (${chain.length} records)` }
        : { name: 'ledger', status: 'fail', detail: `latest session chain BROKEN: ${chain.reason ?? 'unknown'}` },
    ];
  } catch (error) {
    return [{ name: 'ledger', status: 'fail', detail: `cannot read latest ledger: ${String(error).slice(0, 120)}` }];
  }
}
