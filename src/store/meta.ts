import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import type { StorePaths } from './paths.js';

/**
 * Project-level expectations the debrief verifies against: the declared goal
 * and the path globs the agent is supposed to stay inside. Everything here is
 * optional — with no scope declared, the debrief reports distribution instead
 * of judging drift.
 */

export const metaSchema = z.object({
  v: z.literal(1),
  goal: z.string().optional(),
  scope: z.array(z.string().min(1)).default([]),
  createdAt: z.string().optional(),
});
export type ProjectMeta = z.infer<typeof metaSchema>;

const EMPTY_META: ProjectMeta = { v: 1, scope: [] };

export function readMeta(paths: StorePaths): ProjectMeta {
  if (!existsSync(paths.metaFile)) return EMPTY_META;
  try {
    const parsed = metaSchema.safeParse(JSON.parse(readFileSync(paths.metaFile, 'utf8')));
    return parsed.success ? parsed.data : EMPTY_META;
  } catch {
    return EMPTY_META;
  }
}

export function writeMeta(paths: StorePaths, meta: ProjectMeta): void {
  const tmp = `${paths.metaFile}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  renameSync(tmp, paths.metaFile);
}

export function updateMeta(paths: StorePaths, patch: Partial<Omit<ProjectMeta, 'v'>>): ProjectMeta {
  const current = readMeta(paths);
  const next: ProjectMeta = {
    ...current,
    ...(patch.goal !== undefined ? { goal: patch.goal } : {}),
    ...(patch.scope !== undefined ? { scope: patch.scope } : {}),
    ...(patch.createdAt !== undefined ? { createdAt: patch.createdAt } : {}),
  };
  writeMeta(paths, next);
  return next;
}
