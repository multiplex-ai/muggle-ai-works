import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  RequirementsAgent,
  ImpactAnalysisAgent,
  CodingAgent,
  UnitTestRunner,
  AuthGuard,
  EnvSetupAgent,
  TestScopeAgent,
  QAAgent,
  PRAgent,
} from '@muggleai/agents';
import type { ServiceDescriptor } from '@muggleai/agents';

import {
  runDevCycle,
  mergeConfig,
} from '@muggleai/workflows';
import type {
  DevCycleAgents,
  TaskSpec,
  ChangePlan,
  TestManifest,
  RepoConfig,
  ServiceHandle,
} from '@muggleai/workflows';

import { createJsonLLMClient } from './impl/llm-client.js';
import { runShell, spawnService } from './impl/shell.js';
import { createAuthGuardDeps } from './impl/auth-impl.js';
import { createCodingImpl } from './impl/coding-impl.js';
import { createQADeps, createFetchAllTestCases } from './impl/qa-impl.js';
import { createPRDeps, createTeardownImpl } from './impl/pr-impl.js';

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

  // --- Read required env vars ---
  const muggleApiKey = process.env['MUGGLE_API_KEY'];
  if (!muggleApiKey) {
    throw new Error('Missing required environment variable: MUGGLE_API_KEY');
  }

  const projectId = process.env['MUGGLE_PROJECT_ID'];
  if (!projectId) {
    throw new Error('Missing required environment variable: MUGGLE_PROJECT_ID');
  }

  // --- Load repos config ---
  const reposConfigPath = process.env['MUGGLE_REPOS_CONFIG'] ?? path.join(process.cwd(), 'muggle-repos.json');

  let repos: RepoConfig[] = [];
  if (fs.existsSync(reposConfigPath)) {
    const raw = fs.readFileSync(reposConfigPath, 'utf-8');
    repos = JSON.parse(raw) as RepoConfig[];
  }

  // --- LLM clients ---
  const requirementsLLM = createJsonLLMClient<TaskSpec>();
  const impactLLM = createJsonLLMClient<ChangePlan>();
  const codingLLM = createJsonLLMClient<unknown>();
  const testScopeLLM = createJsonLLMClient<TestManifest>();

  // --- readRepoStructure: list files in a repo, excluding node_modules and .git ---
  const readRepoStructure = async (repoName: string): Promise<string> => {
    const repoConfig = repos.find((r) => r.name === repoName);
    if (!repoConfig) {
      return `(repo "${repoName}" not found in config)`;
    }
    const { output } = await runShell(
      'find . -type f -not -path "*/node_modules/*" -not -path "*/.git/*"',
      repoConfig.path,
    );
    return output;
  };

  // --- discoverServices: no services to start by default ---
  const discoverServices = async (_plan: ChangePlan): Promise<ServiceDescriptor[]> => [];

  // --- startService: spawn via shell.ts ---
  const startService = async (descriptor: ServiceDescriptor): Promise<ServiceHandle> => {
    const handle = await spawnService(descriptor);
    return { name: handle.name, pid: handle.pid };
  };

  // --- Wire all agents ---
  const agents: DevCycleAgents = {
    requirements: (prompt) =>
      new RequirementsAgent({ llm: requirementsLLM }).run(prompt),

    impactAnalysis: (spec) =>
      new ImpactAnalysisAgent({ llm: impactLLM, readRepoStructure }).run(spec),

    coding: (plan, retryCount, failures) =>
      Promise.all(
        plan.perRepo.map((repoEntry) =>
          new CodingAgent({ implement: createCodingImpl(repos, codingLLM) }).run({
            repoEntry,
            retryContext: { retryCount, previousFailures: failures },
          }),
        ),
      ).then((results) => ({ perRepo: results })),

    unitTests: (code) =>
      new UnitTestRunner({
        runShell,
        getTestCommand: (repo) => repos.find((r) => r.name === repo)?.testCommand ?? 'npm test',
        getRepoCwd: (repo) => repos.find((r) => r.name === repo)?.path ?? repo,
      }).run(code),

    ensureAuth: () =>
      new AuthGuard(createAuthGuardDeps()).ensureAuthenticated(),

    envSetup: (plan) =>
      new EnvSetupAgent({ discoverServices, startService }).run(plan),

    testScope: (plan) =>
      new TestScopeAgent({
        llm: testScopeLLM,
        fetchAllTestCases: createFetchAllTestCases(muggleApiKey, projectId),
      }).run({ changePlan: plan }),

    qa: (manifest) =>
      new QAAgent(createQADeps(muggleApiKey, projectId)).run(manifest),

    openPRs: (input) =>
      new PRAgent(createPRDeps(repos)).run(input),

    teardown: createTeardownImpl(),
  };

  try {
    const result = await runDevCycle(userPrompt, agents, mergeConfig({ repos }));
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
