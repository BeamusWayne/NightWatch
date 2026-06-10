import type { DebriefReport } from './report.js';
import { classLabel, t } from './i18n.js';
import type { Lang } from './i18n.js';

/**
 * Renderers are pure: DebriefReport in, string out. Markdown is the canonical
 * format (reports get committed, pasted into PRs, sent to chat); the terminal
 * renderer is the same content with ANSI accents and no tables.
 */

export function renderMarkdown(report: DebriefReport, lang: Lang): string {
  const lines: string[] = [];
  const findings = countFindings(report);

  lines.push(`# ${t('title', lang)}`);
  lines.push('');
  lines.push(`- **${t('session', lang)}**: \`${report.session}\``);
  if (report.model) lines.push(`- **${t('model', lang)}**: ${report.model}`);
  if (report.spanHours !== undefined) {
    lines.push(`- **${t('duration', lang)}**: ${report.spanHours.toFixed(1)}${t('hours', lang)} · ${report.stats.events} ${t('events', lang)} · ${report.stats.toolUses} ${t('toolUses', lang)}`);
  }
  if (report.goal) lines.push(`- **${t('goal', lang)}**: ${report.goal}`);
  else if (report.promptPreview) lines.push(`- **${t('firstPrompt', lang)}**: ${report.promptPreview}`);
  lines.push(`- **${t('generatedAt', lang)}**: ${report.generatedAt}`);
  lines.push('');

  lines.push(`## ${t('verdictTitle', lang)}`);
  lines.push('');
  lines.push(findings === 0 ? `✅ ${t('verdictClean', lang)}` : `⚠️ ${t('verdictAttention', lang, { n: findings })}`);
  lines.push('');

  lines.push(`## ${t('chainTitle', lang)}`);
  lines.push('');
  lines.push(chainLine(report, lang));
  if (report.spilledEvents > 0) lines.push(`- ⚠️ ${t('spilled', lang, { n: report.spilledEvents })}`);
  lines.push('');

  lines.push(`## ${t('timelineTitle', lang)}`);
  lines.push('');
  for (const phase of report.phases) {
    const time = `${clock(phase.startTs)}–${clock(phase.endTs)}`;
    const sample = phase.sampleTargets.length > 0 ? ` — ${phase.sampleTargets.join(', ')}` : '';
    lines.push(`- \`${time}\` **${classLabel(phase.cls, lang)}** ×${phase.count} @ \`${phase.area}\`${sample}`);
  }
  lines.push('');

  lines.push(`## ${t('claimsTitle', lang)}`);
  lines.push('');
  if (report.testClaims.length === 0) {
    lines.push(t('noTestClaims', lang));
  } else {
    for (const claim of report.testClaims) {
      lines.push(`- ${claimIcon(claim.status)} seq ${claim.seq} ${t('testClaim', lang)} \`${claim.command.slice(0, 80)}\` → ${claimText(claim.status, lang)} (${claim.detail})`);
    }
  }
  lines.push('');

  lines.push(`## ${t('gitTitle', lang)}`);
  lines.push('');
  if (report.gitOps.length === 0) lines.push(t('noGitOps', lang));
  else for (const op of report.gitOps) lines.push(`- seq ${op.seq}: \`git ${op.op}\` — \`${op.command.slice(0, 100)}\``);
  lines.push('');

  lines.push(...scopeSection(report, lang));

  lines.push(`## ${t('checkpointsTitle', lang)}`);
  lines.push('');
  if (report.checkpoints.length === 0) {
    lines.push(t('noCheckpoints', lang));
  } else {
    for (const cp of report.checkpoints) {
      lines.push(`- #${cp.seq} \`${cp.commit.slice(0, 12)}\` ${clock(cp.ts)} — ${t('restoreHint', lang)}: \`git restore --source=${cp.commit.slice(0, 12)} --worktree -- .\``);
    }
  }
  lines.push('');
  return lines.join('\n');
}

export function renderTerminal(report: DebriefReport, lang: Lang, color: boolean): string {
  const markdown = renderMarkdown(report, lang);
  if (!color) return markdown;
  return markdown
    .replace(/^# (.+)$/gm, (_, text: string) => `\u001b[1m\u001b[36m${text}\u001b[0m`)
    .replace(/^## (.+)$/gm, (_, text: string) => `\u001b[1m${text}\u001b[0m`)
    .replace(/\*\*([^*]+)\*\*/g, (_, text: string) => `\u001b[1m${text}\u001b[0m`);
}

function scopeSection(report: DebriefReport, lang: Lang): string[] {
  const lines: string[] = [`## ${t('scopeTitle', lang)}`, ''];
  const scope = report.scope;

  if (scope.scopePatterns.length > 0) lines.push(`- ${t('scopeDeclared', lang)}: \`${scope.scopePatterns.join('`, `')}\``);
  else lines.push(`- ${t('scopeNone', lang)}`);

  if (scope.groundTruth === 'unavailable') {
    lines.push(`- ⚠️ ${t('scopeNoGit', lang)}`);
  } else {
    lines.push(`- ${t('filesChanged', lang, { n: scope.actualPaths.length })}`);
    if (scope.inScopeRatio !== undefined) lines.push(`- ${t('inScope', lang, { pct: Math.round(scope.inScopeRatio * 100) })}`);
  }

  lines.push(`- ${t('outOfScope', lang)}: ${listOrNone(scope.outOfScope, lang)}`);
  if (scope.groundTruth === 'git') lines.push(`- ${t('unclaimed', lang)}: ${listOrNone(scope.unclaimed, lang)}`);
  lines.push('');
  return lines;
}

function listOrNone(paths: readonly string[], lang: Lang): string {
  if (paths.length === 0) return t('noneFlag', lang);
  const shown = paths.slice(0, 10).map(p => `\`${p}\``);
  const suffix = paths.length > 10 ? ` … +${paths.length - 10}` : '';
  return `⚠️ ${shown.join(', ')}${suffix}`;
}

function chainLine(report: DebriefReport, lang: Lang): string {
  if (report.chain.ok) return `✅ ${t('chainOk', lang, { n: report.chain.length })}`;
  if (report.chain.truncated) return `🚨 ${t('chainTruncated', lang, { reason: report.chain.reason ?? '' })}`;
  return `🚨 ${t('chainBroken', lang, { seq: report.chain.brokenAtSeq ?? '?', reason: report.chain.reason ?? '' })}`;
}

function claimIcon(status: string): string {
  switch (status) {
    case 'verified': return '✅';
    case 'now_failing': return '🚨';
    case 'mismatch': return '⚠️';
    case 'error': return '⚠️';
    default: return '⏭️';
  }
}

function claimText(status: string, lang: Lang): string {
  switch (status) {
    case 'verified': return t('claimVerified', lang);
    case 'now_failing': return t('claimNowFailing', lang);
    case 'mismatch': return t('claimMismatch', lang);
    case 'error': return t('claimError', lang);
    default: return t('claimSkipped', lang);
  }
}

/** Findings = anything that should block blind trust in the run. */
export function countFindings(report: DebriefReport): number {
  let findings = 0;
  if (!report.chain.ok) findings += 1;
  if (report.spilledEvents > 0) findings += 1;
  findings += report.testClaims.filter(c => c.status === 'now_failing' || c.status === 'error').length;
  findings += report.scope.outOfScope.length > 0 ? 1 : 0;
  findings += report.scope.groundTruth === 'git' && report.scope.unclaimed.length > 0 ? 1 : 0;
  return findings;
}

function clock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
