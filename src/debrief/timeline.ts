import type { ActionClass, LedgerRecord } from '../core/record.js';

/**
 * Compress hundreds of tool events into a reviewable timeline. Consecutive
 * events sharing (action class, top-level area) merge into one phase — the
 * reviewer cares that the agent "edited src/utils for 40 minutes", not about
 * each of the 31 individual edits.
 */

export interface Phase {
  readonly startSeq: number;
  readonly endSeq: number;
  readonly startTs: string;
  readonly endTs: string;
  readonly cls: ActionClass;
  readonly area: string;
  readonly count: number;
  readonly sampleTargets: readonly string[];
}

const MAX_SAMPLES = 3;

export function buildTimeline(records: readonly LedgerRecord[]): readonly Phase[] {
  const phases: Phase[] = [];
  let current: MutablePhase | undefined;

  for (const record of records) {
    if (record.event !== 'tool_use' || !record.action) continue;
    const area = areaOf(record.action.summary, record.action.class);
    if (current && current.cls === record.action.class && current.area === area) {
      current.endSeq = record.seq;
      current.endTs = record.ts;
      current.count += 1;
      addSample(current, record.action.summary);
      continue;
    }
    if (current) phases.push(freeze(current));
    current = {
      startSeq: record.seq,
      endSeq: record.seq,
      startTs: record.ts,
      endTs: record.ts,
      cls: record.action.class,
      area,
      count: 1,
      sampleTargets: [],
    };
    addSample(current, record.action.summary);
  }
  if (current) phases.push(freeze(current));
  return phases;
}

interface MutablePhase {
  startSeq: number;
  endSeq: number;
  startTs: string;
  endTs: string;
  cls: ActionClass;
  area: string;
  count: number;
  sampleTargets: string[];
}

function addSample(phase: MutablePhase, target: string): void {
  if (!target || phase.sampleTargets.includes(target) || phase.sampleTargets.length >= MAX_SAMPLES) return;
  phase.sampleTargets.push(target);
}

function freeze(phase: MutablePhase): Phase {
  return { ...phase, sampleTargets: [...phase.sampleTargets] };
}

/** Top-level grouping key: first path segment for paths, class name otherwise. */
export function areaOf(target: string, cls: ActionClass): string {
  if (!target) return cls;
  if (target.startsWith('http://') || target.startsWith('https://')) return 'web';
  const cleaned = target.replace(/^\.\//, '');
  if (/^[\w@.-]+\//.test(cleaned)) {
    const first = cleaned.split('/', 1)[0];
    return first ?? cls;
  }
  if (cleaned.startsWith('/')) {
    const segments = cleaned.split('/').filter(Boolean);
    return segments.length > 1 ? `/${segments[0]}` : cls;
  }
  // A bare directory-ish token ("src") from read/write tools groups with the
  // paths under it; exec/vcs targets are command lines and keep the class key.
  if ((cls === 'read' || cls === 'write') && !cleaned.includes(' ')) return cleaned;
  return cls;
}

export function spanHours(records: readonly LedgerRecord[]): number | undefined {
  const first = records[0];
  const last = records[records.length - 1];
  if (!first || !last) return undefined;
  const ms = Date.parse(last.ts) - Date.parse(first.ts);
  return Number.isFinite(ms) && ms >= 0 ? ms / 3_600_000 : undefined;
}
