import { runDevCycle, mergeConfig } from '@muggleai/workflows';
import type { DevCycleAgents } from '@muggleai/workflows';

/**
 * Entrypoint for the dev cycle workflow runner.
 *
 * Wires real agent implementations to the workflow DAG.
 * Each agent dependency is injected here — the workflow and agents
 * have no direct dependencies on each other.
 */
async function main(): Promise<void> {
  const userPrompt = process.argv[2];
  if (!userPrompt) {
    console.error('Usage: node index.js "<your development task>"');
    process.exit(1);
  }

  const config = mergeConfig({
    repos: [], // TODO: load from project config file
  });

  // TODO: wire real agent implementations
  const agents: DevCycleAgents = {
    requirements: async (_prompt) => { throw new Error('Not implemented'); },
    impactAnalysis: async (_spec) => { throw new Error('Not implemented'); },
    coding: async (_plan, _retry, _failures) => { throw new Error('Not implemented'); },
    unitTests: async (_code) => { throw new Error('Not implemented'); },
    ensureAuth: async () => { throw new Error('Not implemented'); },
    envSetup: async (_plan) => { throw new Error('Not implemented'); },
    testScope: async (_plan) => { throw new Error('Not implemented'); },
    qa: async (_manifest) => { throw new Error('Not implemented'); },
    openPRs: async (_input) => { throw new Error('Not implemented'); },
    teardown: async (_env) => { throw new Error('Not implemented'); },
  };

  try {
    const result = await runDevCycle(userPrompt, agents, config);
    console.log('Dev cycle complete!');
    console.log('PRs opened:', result.prUrls.join('\n'));
    if (result.qaReport.failed.length > 0) {
      console.warn('QA failures:', result.qaReport.failed.map((f) => f.testCase.useCase).join(', '));
    }
  } catch (err) {
    console.error('Dev cycle failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
