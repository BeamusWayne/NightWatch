import { describe, expect, it } from 'vitest';
import { isAutoCheckpointEvent } from '../../src/checkpoint/checkpoints.js';

describe('isAutoCheckpointEvent', () => {
  it('checkpoints at session start so single-turn runs get a pre-run baseline', () => {
    expect(isAutoCheckpointEvent('SessionStart')).toBe(true);
    expect(isAutoCheckpointEvent('sessionstart')).toBe(true);
  });

  it('checkpoints at every turn end', () => {
    expect(isAutoCheckpointEvent('Stop')).toBe(true);
  });

  it('ignores high-frequency events', () => {
    expect(isAutoCheckpointEvent('PostToolUse')).toBe(false);
    expect(isAutoCheckpointEvent('UserPromptSubmit')).toBe(false);
    expect(isAutoCheckpointEvent('SessionEnd')).toBe(false);
  });
});
