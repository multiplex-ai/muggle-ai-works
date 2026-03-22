import { describe, it, expect } from 'vitest';
import { defaultConfig, mergeConfig } from '../config.js';

describe('WorkflowConfig', () => {
  it('defaults have requireQAPass true', () => {
    expect(defaultConfig.requireQAPass).toBe(true);
  });

  it('mergeConfig overrides requireQAPass', () => {
    const merged = mergeConfig({ requireQAPass: false });
    expect(merged.requireQAPass).toBe(false);
  });
});
