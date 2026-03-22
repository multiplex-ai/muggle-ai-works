import {
  UnitTestRunner,
  AuthGuard,
  EnvSetupAgent,
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
  ChangePlan,
  CodeResult,
  ServiceHandle,
} from '@muggleai/workflows';

import { runShell, spawnService } from './impl/shell.js';
import { createAuthGuardDeps } from './impl/auth-impl.js';
import { createQADeps, createFetchAllTestCases } from './impl/qa-impl.js';
import { createPRDeps, createTeardownImpl } from './impl/pr-impl.js';
import { readGitState, getChangedFiles, getDefaultBranch } from './impl/git-state.js';
import { ensureRunnerConfig } from './setup.js';

async function main(): Promise<void> {
  const userPrompt = process.argv[2];
  if (!userPrompt) {
    console.error('Usage: muggle "<task description>"');
    process.exit(1);
  }

  const { muggleApiKey, projectId, repos } = await ensureRunnerConfig();

  // --- discoverServices: no services by default ---
  const discoverServices = async (_plan: ChangePlan): Promise<ServiceDescriptor[]> => [];

  const startService = async (descriptor: ServiceDescriptor): Promise<ServiceHandle> => {
    const handle = await spawnService(descriptor);
    return { name: handle.name, pid: handle.pid };
  };

  const agents: DevCycleAgents = {
    // Requirements: the AI already understands the task — just structure the prompt
    requirements: async (prompt) => ({
      goal: prompt,
      acceptanceCriteria: [],
      hintedRepos: repos.map((r) => r.name),
    }),

    // Impact analysis: detect which repos actually have git changes
    impactAnalysis: async (spec) => {
      const perRepo = (
        await Promise.all(
          spec.hintedRepos.map(async (repoName) => {
            const repoConfig = repos.find((r) => r.name === repoName);
            if (!repoConfig) return null;
            const changedFiles = await getChangedFiles(repoConfig.path);
            if (changedFiles.length === 0) return null;
            return {
              repo: repoName,
              changes: changedFiles,
              files: changedFiles,
              requiredForQA: true,
            };
          }),
        )
      ).filter((r): r is NonNullable<typeof r> => r !== null);

      if (perRepo.length === 0) {
        throw new Error('No git changes detected in any configured repo. Make your changes first, then run muggle.');
      }

      return { resolvedRepos: perRepo.map((r) => r.repo), perRepo };
    },

    // Coding: read what the AI already wrote — current git state
    coding: async (plan): Promise<CodeResult> => {
      const perRepo = await Promise.all(
        plan.perRepo.map(async (entry) => {
          const repoConfig = repos.find((r) => r.name === entry.repo);
          if (!repoConfig) {
            return { repo: entry.repo, branch: '', diff: '', status: 'failed' as const, error: `Repo "${entry.repo}" not in config` };
          }
          const { branch, diff } = await readGitState(repoConfig.path);
          const defaultBranch = await getDefaultBranch(repoConfig.path);
          if (branch === defaultBranch) {
            throw new Error(`Repo "${entry.repo}" is on "${branch}". Create a feature branch before running muggle.`);
          }
          return { repo: entry.repo, branch, diff, status: 'success' as const };
        }),
      );
      return { perRepo };
    },

    // Unit tests: run the configured test command in each repo
    unitTests: (code) =>
      new UnitTestRunner({
        runShell,
        getTestCommand: (repo) => repos.find((r) => r.name === repo)?.testCommand ?? 'pnpm test',
        getRepoCwd: (repo) => repos.find((r) => r.name === repo)?.path ?? repo,
      }).run(code),

    ensureAuth: () => new AuthGuard(createAuthGuardDeps()).ensureAuthenticated(),

    envSetup: (plan) =>
      new EnvSetupAgent({ discoverServices, startService }).run(plan),

    // Test scope: fetch all test cases — no LLM filtering needed
    testScope: async () => {
      const allTests = await createFetchAllTestCases(muggleApiKey, projectId)();
      return { testCases: allTests };
    },

    qa: (manifest) =>
      new QAAgent(createQADeps(muggleApiKey, projectId)).run(manifest),

    openPRs: (input) =>
      new PRAgent(createPRDeps(repos)).run(input),

    teardown: createTeardownImpl(),
  };

  try {
    const result = await runDevCycle(
      userPrompt,
      agents,
      mergeConfig({}),
    );
    console.log('Done!');
    console.log('PRs:', result.prUrls.join('\n'));
    if (result.qaReport.failed.length > 0) {
      console.warn('QA failures:', result.qaReport.failed.map((f) => f.testCase.useCase).join(', '));
    }
  } catch (err) {
    console.error('Failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
