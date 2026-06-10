import { z } from 'zod';

/**
 * Claude Code hook stdin payloads. Schemas are deliberately loose
 * (passthrough + optional fields): hook payloads are an external surface that
 * evolves between harness releases, and the recorder must keep working when
 * new fields appear. Only the fields NightWatch actually consumes are typed.
 */

const base = z
  .object({
    session_id: z.string().min(1),
    transcript_path: z.string().optional(),
    cwd: z.string().optional(),
    hook_event_name: z.string().min(1),
  })
  .passthrough();

export const hookPayloadSchema = base.extend({
  tool_name: z.string().optional(),
  tool_input: z.record(z.string(), z.unknown()).optional(),
  tool_response: z.unknown().optional(),
  prompt: z.string().optional(),
  source: z.string().optional(),
  model: z.string().optional(),
  stop_hook_active: z.boolean().optional(),
});
export type HookPayload = z.infer<typeof hookPayloadSchema>;

export function parseHookPayload(raw: string): HookPayload {
  return hookPayloadSchema.parse(JSON.parse(raw));
}

/** Flatten the harness's tool_response variants into reviewable text. */
export function responseText(toolResponse: unknown): string {
  if (typeof toolResponse === 'string') return toolResponse;
  if (toolResponse === null || toolResponse === undefined) return '';
  if (Array.isArray(toolResponse)) return toolResponse.map(responseText).join('\n');
  if (typeof toolResponse === 'object') {
    const record = toolResponse as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of ['stdout', 'stderr', 'output', 'text', 'content', 'result', 'error']) {
      const value = record[key];
      if (typeof value === 'string' && value.length > 0) parts.push(value);
      else if (value !== undefined && value !== null && typeof value !== 'object') parts.push(String(value));
      else if (Array.isArray(value) || (value && typeof value === 'object')) parts.push(responseText(value));
    }
    return parts.join('\n');
  }
  return String(toolResponse);
}
