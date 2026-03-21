import type { CodeResult, UnitTestResult, UnitTestResultRepo } from '@muggleai/workflows';
import type { IAgent } from './types.js';

export interface ShellResult { exitCode: number; output: string; }
export interface UnitTestRunnerDeps {
  runShell: (command: string, cwd: string) => Promise<ShellResult>;
  getTestCommand: (repo: string) => string;
}

export class UnitTestRunner implements IAgent<CodeResult, UnitTestResult> {
  constructor(private readonly deps: UnitTestRunnerDeps) {}

  async run(codeResult: CodeResult): Promise<UnitTestResult> {
    const results = await Promise.all(
      codeResult.perRepo.map(async (entry): Promise<UnitTestResultRepo> => {
        if (entry.status === 'failed') {
          return { repo: entry.repo, passed: false, output: entry.error ?? '', failedTests: [] };
        }
        const cmd = this.deps.getTestCommand(entry.repo);
        const { exitCode, output } = await this.deps.runShell(cmd, entry.repo);
        return {
          repo: entry.repo, passed: exitCode === 0, output,
          failedTests: exitCode !== 0 ? this.parseFailedTests(output) : [],
        };
      })
    );
    return { perRepo: results };
  }

  private parseFailedTests(output: string): string[] {
    return output.split('\n')
      .filter((line) => line.includes('FAIL') || line.includes('✗') || line.includes('× '))
      .map((line) => line.trim());
  }
}
