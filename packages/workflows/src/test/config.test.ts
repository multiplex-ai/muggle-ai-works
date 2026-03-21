import { describe, it, expect } from 'vitest';
import { defaultConfig, mergeConfig } from '../config.js';

describe('WorkflowConfig', () => {
  it('defaults have requireQAPass true', () => {
    expect(defaultConfig.requireQAPass).toBe(true);
  });

  it('defaults have maxRetries 3', () => {
    expect(defaultConfig.maxRetries).toBe(3);
  });

  it('mergeConfig overrides only provided fields', () => {
    const merged = mergeConfig({ maxRetries: 5 });
    expect(merged.maxRetries).toBe(5);
    expect(merged.requireQAPass).toBe(true);
  });
});
