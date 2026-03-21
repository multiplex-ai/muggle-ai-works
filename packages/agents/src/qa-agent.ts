import type { TestManifest, QAReport, TestCaseRef } from '@muggleai/workflows';
import type { IAgent } from './types.js';

export interface TestCaseRunResult { passed: boolean; reason?: string; repro?: string; }
export interface QAAgentDeps { runTestCase: (testCase: TestCaseRef) => Promise<TestCaseRunResult>; }

export class QAAgent implements IAgent<TestManifest, QAReport> {
  constructor(private readonly deps: QAAgentDeps) {}

  async run(manifest: TestManifest): Promise<QAReport> {
    const results = await Promise.all(
      manifest.testCases.map(async (testCase) => ({
        testCase,
        result: await this.deps.runTestCase(testCase),
      }))
    );
    return {
      passed: results.filter((r) => r.result.passed).map((r) => r.testCase),
      failed: results.filter((r) => !r.result.passed).map((r) => ({
        testCase: r.testCase,
        reason: r.result.reason ?? 'unknown',
        repro: r.result.repro ?? '',
      })),
    };
  }
}
