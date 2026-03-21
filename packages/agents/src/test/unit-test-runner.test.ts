import { describe, it, expect, vi } from 'vitest';
import { UnitTestRunner } from '../unit-test-runner.js';
import type { CodeResult } from '@muggleai/workflows';

const codeResult: CodeResult = { perRepo: [{ repo: 'frontend', branch: 'feat/login', diff: '', status: 'success' }] };

describe('UnitTestRunner', () => {
  it('returns passed: true when shell command exits 0', async () => {
    const runShell = vi.fn().mockResolvedValue({ exitCode: 0, output: 'All tests passed' });
    const runner = new UnitTestRunner({ runShell, getTestCommand: () => 'pnpm test', getRepoCwd: vi.fn().mockReturnValue('/repos/frontend') });
    const result = await runner.run(codeResult);
    expect(result.perRepo[0].passed).toBe(true);
    expect(result.perRepo[0].failedTests).toHaveLength(0);
  });

  it('returns passed: false when shell command exits non-zero', async () => {
    const runShell = vi.fn().mockResolvedValue({ exitCode: 1, output: 'FAIL src/Login.test.tsx' });
    const runner = new UnitTestRunner({ runShell, getTestCommand: () => 'pnpm test', getRepoCwd: vi.fn().mockReturnValue('/repos/frontend') });
    const result = await runner.run(codeResult);
    expect(result.perRepo[0].passed).toBe(false);
    expect(result.perRepo[0].output).toContain('FAIL');
  });

  it('skips repos with failed status in CodeResult', async () => {
    const runShell = vi.fn();
    const failedCode: CodeResult = { perRepo: [{ repo: 'x', branch: '', diff: '', status: 'failed' }] };
    const runner = new UnitTestRunner({ runShell, getTestCommand: () => 'pnpm test', getRepoCwd: vi.fn().mockReturnValue('/repos/frontend') });
    const result = await runner.run(failedCode);
    expect(runShell).not.toHaveBeenCalled();
    expect(result.perRepo[0].passed).toBe(false);
  });
});
