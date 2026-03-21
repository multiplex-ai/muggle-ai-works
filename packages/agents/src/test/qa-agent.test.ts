import { describe, it, expect, vi } from 'vitest';
import { QAAgent } from '../qa-agent.js';
import type { TestManifest } from '@muggleai/workflows';

const manifest: TestManifest = {
  testCases: [
    { id: 'tc-001', useCase: 'Login', description: 'User can log in' },
    { id: 'tc-002', useCase: 'Logout', description: 'User can log out' },
  ],
};

describe('QAAgent', () => {
  it('runs each test case and returns QAReport', async () => {
    const runTestCase = vi.fn().mockResolvedValueOnce({ passed: true }).mockResolvedValueOnce({ passed: true });
    const agent = new QAAgent({ runTestCase });
    const report = await agent.run(manifest);
    expect(report.passed).toHaveLength(2);
    expect(report.failed).toHaveLength(0);
  });

  it('adds failed test cases to QAReport.failed with reason', async () => {
    const runTestCase = vi.fn()
      .mockResolvedValueOnce({ passed: false, reason: 'timeout', repro: 'open /login' })
      .mockResolvedValueOnce({ passed: true });
    const agent = new QAAgent({ runTestCase });
    const report = await agent.run(manifest);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0].reason).toBe('timeout');
    expect(report.passed).toHaveLength(1);
  });

  it('calls runTestCase with the test case ID', async () => {
    const runTestCase = vi.fn().mockResolvedValue({ passed: true });
    const agent = new QAAgent({ runTestCase });
    await agent.run(manifest);
    expect(runTestCase).toHaveBeenCalledWith(expect.objectContaining({ id: 'tc-001' }));
    expect(runTestCase).toHaveBeenCalledWith(expect.objectContaining({ id: 'tc-002' }));
  });
});
