# Autonomous Development Cycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an autonomous development cycle that accepts conversational requirements and produces QA-verified PRs across one or more repositories.

**Architecture:** A typed workflow DAG (in `packages/workflows`) is executed by a custom runner (`apps/workflows-runner`). Each stage in the DAG delegates to a specialized agent (`packages/agents`). The QA stages use the existing Muggle AI MCP tools from `packages/mcps`.

**Tech Stack:** TypeScript (ESM, NodeNext), Vitest, `@muggleai/mcp` (internal), Anthropic Claude API (for agent LLM calls), GitHub API (for PRs), pnpm workspaces, Turbo.

---

## Parallelization Guide for Agent Teams

This plan is organized into four phases. Phases 2 and 3 can be executed in parallel once Phase 1 is complete.

```
Phase 1: Foundations      (Tasks 1–3)   — must complete first
         ↓
Phase 2: Core Agents      (Tasks 4–9)    ┐ parallel
Phase 3: QA Pipeline      (Tasks 10–13) ┘ parallel
         ↓
Phase 4: Integration      (Tasks 14–16) — must complete last
```

---

## File Structure

### New files to create

```
packages/workflows/src/
  contracts.ts          — all data contract interfaces (TaskSpec, ChangePlan, CodeResult, etc.)
  config.ts             — WorkflowConfig interface + defaults
  dag.ts                — DAG node/edge types and stage enum
  runner.ts             — workflow executor: runs stages, owns retryCount, handles branching
  dev-cycle.ts          — the dev cycle DAG definition (wires all 9 stages)
  index.ts              — re-exports everything

packages/workflows/src/test/
  runner.test.ts        — unit tests for retry logic, halt conditions, branching
  contracts.test.ts     — type-level smoke tests

packages/agents/src/
  types.ts              — shared agent interface (IAgent<TInput, TOutput>)
  requirements-agent.ts — stage 1: conversation → TaskSpec
  impact-analysis-agent.ts — stage 2: repos + TaskSpec → ChangePlan
  coding-agent.ts       — stage 3: ChangePlan entry → CodeResult entry (one per repo)
  unit-test-runner.ts   — stage 4: CodeResult → UnitTestResult
  env-setup-agent.ts    — stage 5: ChangePlan → EnvState
  test-scope-agent.ts   — stage 6: ChangePlan + QAReport? → TestManifest
  qa-agent.ts           — stage 7: TestManifest + EnvState → QAReport
  pr-agent.ts           — stage 8: PRInput → PR URLs
  index.ts              — re-exports all agents

packages/agents/src/test/
  requirements-agent.test.ts
  impact-analysis-agent.test.ts
  coding-agent.test.ts
  unit-test-runner.test.ts
  env-setup-agent.test.ts
  test-scope-agent.test.ts
  qa-agent.test.ts
  pr-agent.test.ts

apps/workflows-runner/src/
  index.ts              — CLI entrypoint: loads WorkflowConfig, starts dev cycle workflow
```

### Existing files to modify

```
packages/workflows/package.json   — add vitest, update scripts
packages/agents/package.json      — add vitest + anthropic SDK dep, update scripts
apps/workflows-runner/package.json — add dep on packages/workflows + packages/agents
```

---

## Phase 1: Foundations

### Task 1: Data Contracts

**Files:**
- Create: `packages/workflows/src/contracts.ts`
- Create: `packages/workflows/src/contracts.test.ts`

- [ ] **Step 1: Write the contracts file**

```typescript
// packages/workflows/src/contracts.ts

export interface TaskSpec {
  goal: string;
  acceptanceCriteria: string[];
  hintedRepos: string[];
}

export interface ChangePlanRepo {
  repo: string;
  changes: string[];
  files: string[];
  requiredForQA: boolean;
}

export interface ChangePlan {
  resolvedRepos: string[];
  perRepo: ChangePlanRepo[];
}

export interface CodeResultRepo {
  repo: string;
  branch: string;
  diff: string;
  status: 'success' | 'failed';
  error?: string;
}

export interface CodeResult {
  perRepo: CodeResultRepo[];
}

export interface UnitTestResultRepo {
  repo: string;
  passed: boolean;
  output: string;
  failedTests: string[];
}

export interface UnitTestResult {
  perRepo: UnitTestResultRepo[];
}

export interface TestCaseRef {
  id: string;
  useCase: string;
  description: string;
}

export interface TestManifest {
  testCases: TestCaseRef[];
  skipReason?: string;
}

export interface ServiceHandle {
  name: string;
  pid?: number;
  containerId?: string;
  stopCommand?: string;
}

export interface EnvState {
  services: ServiceHandle[];
}

export interface QAReport {
  passed: TestCaseRef[];
  failed: Array<{
    testCase: TestCaseRef;
    reason: string;
    repro: string;
  }>;
}

export interface PRInput {
  taskSpec: TaskSpec;
  changePlan: ChangePlan;
  codeResult: CodeResult;
  qaReport: QAReport;
}
```

- [ ] **Step 2: Write a type-level smoke test**

```typescript
// packages/workflows/src/contracts.test.ts
import { describe, it, expectTypeOf } from 'vitest';
import type { TaskSpec, ChangePlan, QAReport, PRInput } from './contracts.js';

describe('contracts', () => {
  it('TaskSpec has required fields', () => {
    expectTypeOf<TaskSpec>().toHaveProperty('goal');
    expectTypeOf<TaskSpec>().toHaveProperty('acceptanceCriteria');
    expectTypeOf<TaskSpec>().toHaveProperty('hintedRepos');
  });

  it('ChangePlan perRepo entries have requiredForQA', () => {
    expectTypeOf<ChangePlan['perRepo'][number]>().toHaveProperty('requiredForQA');
  });

  it('QAReport tracks passed and failed test cases', () => {
    expectTypeOf<QAReport>().toHaveProperty('passed');
    expectTypeOf<QAReport>().toHaveProperty('failed');
  });

  it('PRInput bundles all workflow artifacts', () => {
    expectTypeOf<PRInput>().toHaveProperty('taskSpec');
    expectTypeOf<PRInput>().toHaveProperty('changePlan');
    expectTypeOf<PRInput>().toHaveProperty('codeResult');
    expectTypeOf<PRInput>().toHaveProperty('qaReport');
  });
});
```

- [ ] **Step 3: Set up vitest in packages/workflows**

Update `packages/workflows/package.json` to add:
```json
{
  "scripts": {
    "build": "tsc --noEmit",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint ."
  },
  "devDependencies": {
    "vitest": "*",
    "typescript": "*"
  }
}
```

Add `packages/workflows/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/workflows && pnpm test
```
Expected: all type tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/workflows/
git commit -m "feat(workflows): add data contracts and types"
```

---

### Task 2: WorkflowConfig

**Files:**
- Create: `packages/workflows/src/config.ts`
- Create: `packages/workflows/src/config.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/workflows/src/config.test.ts
import { describe, it, expect } from 'vitest';
import { defaultConfig, mergeConfig } from './config.js';

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
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd packages/workflows && pnpm test
```
Expected: FAIL — `config.js` not found.

- [ ] **Step 3: Implement**

```typescript
// packages/workflows/src/config.ts

export interface RepoConfig {
  name: string;
  path: string;
  testCommand: string;
}

export interface WorkflowConfig {
  repos: RepoConfig[];
  maxRetries: number;
  qaTimeout: number;
  requireQAPass: boolean;
}

export const defaultConfig: WorkflowConfig = {
  repos: [],
  maxRetries: 3,
  qaTimeout: 600_000,
  requireQAPass: true,
};

export function mergeConfig(partial: Partial<WorkflowConfig>): WorkflowConfig {
  return { ...defaultConfig, ...partial };
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/workflows && pnpm test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/workflows/src/config.ts packages/workflows/src/config.test.ts
git commit -m "feat(workflows): add WorkflowConfig with defaults"
```

---

### Task 3: Workflow DAG and Runner

**Files:**
- Create: `packages/workflows/src/dag.ts`
- Create: `packages/workflows/src/runner.ts`
- Create: `packages/workflows/src/runner.test.ts`
- Create: `packages/workflows/src/index.ts`

- [ ] **Step 1: Define DAG types**

```typescript
// packages/workflows/src/dag.ts

export enum Stage {
  Requirements = 'requirements',
  ImpactAnalysis = 'impact-analysis',
  Coding = 'coding',
  UnitTests = 'unit-tests',
  EnvSetup = 'env-setup',
  TestScope = 'test-scope',
  QA = 'qa',
  OpenPRs = 'open-prs',
  Teardown = 'teardown',
}

export type StageStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';

export interface StageResult<T> {
  stage: Stage;
  status: StageStatus;
  output?: T;
  error?: string;
}

export interface WorkflowState {
  retryCount: number;
  envStarted: boolean;
  tornDown: boolean;
  stageResults: Map<Stage, StageResult<unknown>>;
}

export function initialState(): WorkflowState {
  return {
    retryCount: 0,
    envStarted: false,
    tornDown: false,
    stageResults: new Map(),
  };
}
```

- [ ] **Step 2: Write failing runner tests**

```typescript
// packages/workflows/src/runner.test.ts
import { describe, it, expect, vi } from 'vitest';
import { WorkflowRunner } from './runner.js';
import { defaultConfig } from './config.js';
import type { QAReport, CodeResult } from './contracts.js';

const emptyQAReport: QAReport = { passed: [], failed: [] };

describe('WorkflowRunner', () => {
  it('increments retryCount on each retry', async () => {
    let callCount = 0;
    const runner = new WorkflowRunner(defaultConfig);
    const state = runner.createState();

    runner.recordRetry(state);
    runner.recordRetry(state);
    expect(state.retryCount).toBe(2);
  });

  it('isMaxRetriesExceeded returns true at maxRetries', () => {
    const runner = new WorkflowRunner({ ...defaultConfig, maxRetries: 2 });
    const state = runner.createState();
    state.retryCount = 2;
    expect(runner.isMaxRetriesExceeded(state)).toBe(true);
  });

  it('isMaxRetriesExceeded returns false below maxRetries', () => {
    const runner = new WorkflowRunner({ ...defaultConfig, maxRetries: 3 });
    const state = runner.createState();
    state.retryCount = 2;
    expect(runner.isMaxRetriesExceeded(state)).toBe(false);
  });

  it('needsTeardown returns false if env never started', () => {
    const runner = new WorkflowRunner(defaultConfig);
    const state = runner.createState();
    expect(runner.needsTeardown(state)).toBe(false);
  });

  it('needsTeardown returns true after env starts', () => {
    const runner = new WorkflowRunner(defaultConfig);
    const state = runner.createState();
    state.envStarted = true;
    expect(runner.needsTeardown(state)).toBe(true);
  });

  it('shouldOpenPRsOnFailure returns false when requireQAPass is true', () => {
    const runner = new WorkflowRunner({ ...defaultConfig, requireQAPass: true });
    expect(runner.shouldOpenPRsOnFailure()).toBe(false);
  });

  it('shouldOpenPRsOnFailure returns true when requireQAPass is false', () => {
    const runner = new WorkflowRunner({ ...defaultConfig, requireQAPass: false });
    expect(runner.shouldOpenPRsOnFailure()).toBe(true);
  });

  it('successfulRepos filters CodeResult to success only', () => {
    const runner = new WorkflowRunner(defaultConfig);
    const codeResult: CodeResult = {
      perRepo: [
        { repo: 'a', branch: 'b', diff: '', status: 'success' },
        { repo: 'b', branch: 'b', diff: '', status: 'failed', error: 'oops' },
      ],
    };
    expect(runner.successfulRepos(codeResult)).toEqual(['a']);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

```bash
cd packages/workflows && pnpm test
```
Expected: FAIL — `runner.js` not found.

- [ ] **Step 4: Implement WorkflowRunner**

```typescript
// packages/workflows/src/runner.ts
import type { WorkflowConfig } from './config.js';
import type { CodeResult } from './contracts.js';
import { initialState, WorkflowState } from './dag.js';

export class WorkflowRunner {
  constructor(private readonly config: WorkflowConfig) {}

  createState(): WorkflowState {
    return initialState();
  }

  recordRetry(state: WorkflowState): void {
    state.retryCount += 1;
  }

  isMaxRetriesExceeded(state: WorkflowState): boolean {
    return state.retryCount >= this.config.maxRetries;
  }

  needsTeardown(state: WorkflowState): boolean {
    return state.envStarted;
  }

  shouldOpenPRsOnFailure(): boolean {
    return !this.config.requireQAPass;
  }

  successfulRepos(codeResult: CodeResult): string[] {
    return codeResult.perRepo
      .filter((r) => r.status === 'success')
      .map((r) => r.repo);
  }
}
```

- [ ] **Step 5: Create index.ts**

```typescript
// packages/workflows/src/index.ts
export * from './contracts.js';
export * from './config.js';
export * from './dag.js';
export * from './runner.js';
```

- [ ] **Step 6: Run tests**

```bash
cd packages/workflows && pnpm test
```
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/workflows/src/
git commit -m "feat(workflows): add DAG types and WorkflowRunner"
```

---

## Phase 2: Core Agents

> Can be executed in parallel with Phase 3 after Phase 1 is complete.

### Task 4: Agent Base Types + Package Setup

**Files:**
- Create: `packages/agents/src/types.ts`
- Modify: `packages/agents/package.json`
- Create: `packages/agents/tsconfig.json`

- [ ] **Step 1: Set up packages/agents**

Update `packages/agents/package.json`:
```json
{
  "name": "@muggleai/agents",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": { "default": "./src/index.ts" } },
  "scripts": {
    "build": "tsc --noEmit",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "eslint ."
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.30.0",
    "@muggleai/mcp": "workspace:*",
    "@muggleai/workflows": "workspace:*"
  },
  "devDependencies": {
    "vitest": "*",
    "typescript": "*"
  }
}
```

Add `packages/agents/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 2: Write agent interface**

```typescript
// packages/agents/src/types.ts

export interface IAgent<TInput, TOutput> {
  run(input: TInput): Promise<TOutput>;
}

export interface RetryContext {
  retryCount: number;
  previousFailures: string[];
}
```

- [ ] **Step 3: Install deps**

```bash
pnpm install
```

- [ ] **Step 4: Commit**

```bash
git add packages/agents/
git commit -m "feat(agents): add package setup and IAgent interface"
```

---

### Task 5: RequirementsAgent

**Files:**
- Create: `packages/agents/src/requirements-agent.ts`
- Create: `packages/agents/src/test/requirements-agent.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/agents/src/test/requirements-agent.test.ts
import { describe, it, expect, vi } from 'vitest';
import { RequirementsAgent } from '../requirements-agent.js';
import type { TaskSpec } from '@muggleai/workflows';

describe('RequirementsAgent', () => {
  it('returns a TaskSpec with goal and acceptanceCriteria', async () => {
    const mockLlm = vi.fn().mockResolvedValue({
      goal: 'Add user login',
      acceptanceCriteria: ['User can log in with email/password'],
      hintedRepos: ['frontend'],
    } satisfies TaskSpec);

    const agent = new RequirementsAgent({ llm: mockLlm });
    const result = await agent.run('Add a login feature to the app');

    expect(result.goal).toBe('Add user login');
    expect(result.acceptanceCriteria).toHaveLength(1);
    expect(result.hintedRepos).toContain('frontend');
  });

  it('passes the user prompt to the LLM', async () => {
    const mockLlm = vi.fn().mockResolvedValue({
      goal: 'x', acceptanceCriteria: [], hintedRepos: [],
    });
    const agent = new RequirementsAgent({ llm: mockLlm });
    await agent.run('my prompt');
    expect(mockLlm).toHaveBeenCalledWith(expect.stringContaining('my prompt'));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd packages/agents && pnpm test
```
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// packages/agents/src/requirements-agent.ts
import type { TaskSpec } from '@muggleai/workflows';
import type { IAgent } from './types.js';

export interface RequirementsAgentDeps {
  llm: (prompt: string) => Promise<TaskSpec>;
}

export class RequirementsAgent implements IAgent<string, TaskSpec> {
  constructor(private readonly deps: RequirementsAgentDeps) {}

  async run(userPrompt: string): Promise<TaskSpec> {
    const systemPrompt = `You are a requirements analyst. The user describes a software task.
Extract a structured TaskSpec with:
- goal: a single sentence describing what to build
- acceptanceCriteria: bullet-point list of verifiable conditions
- hintedRepos: list of repository names the user mentioned or implied

User prompt: ${userPrompt}

Respond with valid JSON matching the TaskSpec shape.`;

    return this.deps.llm(systemPrompt);
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/agents && pnpm test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/requirements-agent.ts packages/agents/src/test/requirements-agent.test.ts
git commit -m "feat(agents): add RequirementsAgent"
```

---

### Task 6: ImpactAnalysisAgent

**Files:**
- Create: `packages/agents/src/impact-analysis-agent.ts`
- Create: `packages/agents/src/test/impact-analysis-agent.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/agents/src/test/impact-analysis-agent.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ImpactAnalysisAgent } from '../impact-analysis-agent.js';
import type { TaskSpec, ChangePlan } from '@muggleai/workflows';

const spec: TaskSpec = {
  goal: 'Add login',
  acceptanceCriteria: ['User can log in'],
  hintedRepos: ['frontend'],
};

describe('ImpactAnalysisAgent', () => {
  it('returns a ChangePlan with resolvedRepos', async () => {
    const mockLlm = vi.fn().mockResolvedValue({
      resolvedRepos: ['frontend', 'auth-service'],
      perRepo: [
        { repo: 'frontend', changes: ['Add login page'], files: ['src/Login.tsx'], requiredForQA: true },
        { repo: 'auth-service', changes: ['Add /login endpoint'], files: ['src/routes/auth.ts'], requiredForQA: true },
      ],
    } satisfies ChangePlan);

    const agent = new ImpactAnalysisAgent({ llm: mockLlm, readRepoStructure: vi.fn().mockResolvedValue('{}') });
    const result = await agent.run(spec);

    expect(result.resolvedRepos).toContain('frontend');
    expect(result.perRepo).toHaveLength(2);
    expect(result.perRepo[0].requiredForQA).toBe(true);
  });

  it('reads structure for each hinted repo', async () => {
    const readRepoStructure = vi.fn().mockResolvedValue('{}');
    const mockLlm = vi.fn().mockResolvedValue({ resolvedRepos: [], perRepo: [] });
    const agent = new ImpactAnalysisAgent({ llm: mockLlm, readRepoStructure });
    await agent.run(spec);
    expect(readRepoStructure).toHaveBeenCalledWith('frontend');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd packages/agents && pnpm test
```
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// packages/agents/src/impact-analysis-agent.ts
import type { TaskSpec, ChangePlan } from '@muggleai/workflows';
import type { IAgent } from './types.js';

export interface ImpactAnalysisAgentDeps {
  llm: (prompt: string) => Promise<ChangePlan>;
  readRepoStructure: (repoName: string) => Promise<string>;
}

export class ImpactAnalysisAgent implements IAgent<TaskSpec, ChangePlan> {
  constructor(private readonly deps: ImpactAnalysisAgentDeps) {}

  async run(spec: TaskSpec): Promise<ChangePlan> {
    const structures = await Promise.all(
      spec.hintedRepos.map(async (repo) => ({
        repo,
        structure: await this.deps.readRepoStructure(repo),
      }))
    );

    const prompt = `You are a software architect. Analyze this task and determine which repositories need changes.

Task: ${spec.goal}
Acceptance criteria: ${spec.acceptanceCriteria.join(', ')}
Hinted repos: ${spec.hintedRepos.join(', ')}

Repo structures:
${structures.map((s) => `--- ${s.repo} ---\n${s.structure}`).join('\n\n')}

Produce a ChangePlan JSON:
- resolvedRepos: authoritative list of affected repos (may expand beyond hinted)
- perRepo: array of { repo, changes[], files[], requiredForQA } entries
  - requiredForQA: true if QA cannot run without this repo's changes deployed

Respond with valid JSON.`;

    return this.deps.llm(prompt);
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/agents && pnpm test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/impact-analysis-agent.ts packages/agents/src/test/impact-analysis-agent.test.ts
git commit -m "feat(agents): add ImpactAnalysisAgent"
```

---

### Task 7: CodingAgent

**Files:**
- Create: `packages/agents/src/coding-agent.ts`
- Create: `packages/agents/src/test/coding-agent.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/agents/src/test/coding-agent.test.ts
import { describe, it, expect, vi } from 'vitest';
import { CodingAgent } from '../coding-agent.js';
import type { ChangePlanRepo, CodeResultRepo } from '@muggleai/workflows';

const repoEntry: ChangePlanRepo = {
  repo: 'frontend',
  changes: ['Add login page'],
  files: ['src/Login.tsx'],
  requiredForQA: true,
};

describe('CodingAgent', () => {
  it('returns success CodeResultRepo when LLM succeeds', async () => {
    const mockImplement = vi.fn().mockResolvedValue({ branch: 'feat/login', diff: '+login page' });
    const agent = new CodingAgent({ implement: mockImplement });
    const result = await agent.run({ repoEntry, retryContext: { retryCount: 0, previousFailures: [] } });

    expect(result.status).toBe('success');
    expect(result.branch).toBe('feat/login');
    expect(result.repo).toBe('frontend');
  });

  it('returns failed CodeResultRepo when implementation throws', async () => {
    const mockImplement = vi.fn().mockRejectedValue(new Error('git conflict'));
    const agent = new CodingAgent({ implement: mockImplement });
    const result = await agent.run({ repoEntry, retryContext: { retryCount: 0, previousFailures: [] } });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('git conflict');
  });

  it('passes retryCount to implementation fn', async () => {
    const mockImplement = vi.fn().mockResolvedValue({ branch: 'b', diff: '' });
    const agent = new CodingAgent({ implement: mockImplement });
    await agent.run({ repoEntry, retryContext: { retryCount: 2, previousFailures: ['test failed'] } });
    expect(mockImplement).toHaveBeenCalledWith(expect.objectContaining({ retryCount: 2 }));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd packages/agents && pnpm test
```
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// packages/agents/src/coding-agent.ts
import type { ChangePlanRepo, CodeResultRepo } from '@muggleai/workflows';
import type { IAgent, RetryContext } from './types.js';

export interface CodingAgentInput {
  repoEntry: ChangePlanRepo;
  retryContext: RetryContext;
}

export interface ImplementationResult {
  branch: string;
  diff: string;
}

export interface CodingAgentDeps {
  implement: (input: {
    repoEntry: ChangePlanRepo;
    retryCount: number;
    previousFailures: string[];
  }) => Promise<ImplementationResult>;
}

export class CodingAgent implements IAgent<CodingAgentInput, CodeResultRepo> {
  constructor(private readonly deps: CodingAgentDeps) {}

  async run(input: CodingAgentInput): Promise<CodeResultRepo> {
    try {
      const result = await this.deps.implement({
        repoEntry: input.repoEntry,
        retryCount: input.retryContext.retryCount,
        previousFailures: input.retryContext.previousFailures,
      });
      return {
        repo: input.repoEntry.repo,
        branch: result.branch,
        diff: result.diff,
        status: 'success',
      };
    } catch (err) {
      return {
        repo: input.repoEntry.repo,
        branch: '',
        diff: '',
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/agents && pnpm test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/coding-agent.ts packages/agents/src/test/coding-agent.test.ts
git commit -m "feat(agents): add CodingAgent"
```

---

### Task 8: UnitTestRunner

**Files:**
- Create: `packages/agents/src/unit-test-runner.ts`
- Create: `packages/agents/src/test/unit-test-runner.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/agents/src/test/unit-test-runner.test.ts
import { describe, it, expect, vi } from 'vitest';
import { UnitTestRunner } from '../unit-test-runner.js';
import type { CodeResult } from '@muggleai/workflows';

const codeResult: CodeResult = {
  perRepo: [
    { repo: 'frontend', branch: 'feat/login', diff: '', status: 'success' },
  ],
};

describe('UnitTestRunner', () => {
  it('returns passed: true when shell command exits 0', async () => {
    const runShell = vi.fn().mockResolvedValue({ exitCode: 0, output: 'All tests passed' });
    const runner = new UnitTestRunner({ runShell, getTestCommand: () => 'pnpm test' });
    const result = await runner.run(codeResult);

    expect(result.perRepo[0].passed).toBe(true);
    expect(result.perRepo[0].failedTests).toHaveLength(0);
  });

  it('returns passed: false when shell command exits non-zero', async () => {
    const runShell = vi.fn().mockResolvedValue({ exitCode: 1, output: 'FAIL src/Login.test.tsx' });
    const runner = new UnitTestRunner({ runShell, getTestCommand: () => 'pnpm test' });
    const result = await runner.run(codeResult);

    expect(result.perRepo[0].passed).toBe(false);
    expect(result.perRepo[0].output).toContain('FAIL');
  });

  it('skips repos with failed status in CodeResult', async () => {
    const runShell = vi.fn();
    const failedCode: CodeResult = {
      perRepo: [{ repo: 'x', branch: '', diff: '', status: 'failed' }],
    };
    const runner = new UnitTestRunner({ runShell, getTestCommand: () => 'pnpm test' });
    const result = await runner.run(failedCode);

    expect(runShell).not.toHaveBeenCalled();
    expect(result.perRepo[0].passed).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd packages/agents && pnpm test
```
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// packages/agents/src/unit-test-runner.ts
import type { CodeResult, UnitTestResult, UnitTestResultRepo } from '@muggleai/workflows';
import type { IAgent } from './types.js';

export interface ShellResult {
  exitCode: number;
  output: string;
}

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
          repo: entry.repo,
          passed: exitCode === 0,
          output,
          failedTests: exitCode !== 0 ? this.parseFailedTests(output) : [],
        };
      })
    );
    return { perRepo: results };
  }

  private parseFailedTests(output: string): string[] {
    return output
      .split('\n')
      .filter((line) => line.includes('FAIL') || line.includes('✗') || line.includes('× '))
      .map((line) => line.trim());
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/agents && pnpm test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/unit-test-runner.ts packages/agents/src/test/unit-test-runner.test.ts
git commit -m "feat(agents): add UnitTestRunner"
```

---

### Task 9: PRAgent

**Files:**
- Create: `packages/agents/src/pr-agent.ts`
- Create: `packages/agents/src/test/pr-agent.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/agents/src/test/pr-agent.test.ts
import { describe, it, expect, vi } from 'vitest';
import { PRAgent } from '../pr-agent.js';
import type { PRInput } from '@muggleai/workflows';

const prInput: PRInput = {
  taskSpec: { goal: 'Add login', acceptanceCriteria: [], hintedRepos: [] },
  changePlan: {
    resolvedRepos: ['frontend'],
    perRepo: [{ repo: 'frontend', changes: [], files: [], requiredForQA: true }],
  },
  codeResult: {
    perRepo: [
      { repo: 'frontend', branch: 'feat/login', diff: '+login', status: 'success' },
      { repo: 'backend', branch: '', diff: '', status: 'failed', error: 'compile error' },
    ],
  },
  qaReport: { passed: [], failed: [] },
};

describe('PRAgent', () => {
  it('only opens PRs for successful repos', async () => {
    const openPR = vi.fn().mockResolvedValue('https://github.com/org/repo/pull/1');
    const agent = new PRAgent({ openPR });
    const urls = await agent.run(prInput);

    expect(openPR).toHaveBeenCalledTimes(1);
    expect(openPR).toHaveBeenCalledWith(expect.objectContaining({ repo: 'frontend' }));
    expect(urls).toHaveLength(1);
  });

  it('flags PR title with [QA FAILING] when QA failed', async () => {
    const openPR = vi.fn().mockResolvedValue('https://github.com/org/repo/pull/1');
    const agent = new PRAgent({ openPR });
    const failingQA: PRInput = {
      ...prInput,
      qaReport: {
        passed: [],
        failed: [{ testCase: { id: '1', useCase: 'Login', description: 'login test' }, reason: 'timeout', repro: '' }],
      },
    };
    await agent.run(failingQA);
    expect(openPR).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining('[QA FAILING]') }));
  });

  it('does not include [QA FAILING] when QA passed', async () => {
    const openPR = vi.fn().mockResolvedValue('https://github.com/org/repo/pull/1');
    const agent = new PRAgent({ openPR });
    await agent.run(prInput);
    expect(openPR).toHaveBeenCalledWith(expect.objectContaining({ title: expect.not.stringContaining('[QA FAILING]') }));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd packages/agents && pnpm test
```
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// packages/agents/src/pr-agent.ts
import type { PRInput } from '@muggleai/workflows';
import type { IAgent } from './types.js';

export interface OpenPRInput {
  repo: string;
  branch: string;
  title: string;
  body: string;
}

export interface PRAgentDeps {
  openPR: (input: OpenPRInput) => Promise<string>;
}

export class PRAgent implements IAgent<PRInput, string[]> {
  constructor(private readonly deps: PRAgentDeps) {}

  async run(input: PRInput): Promise<string[]> {
    const hasQAFailures = input.qaReport.failed.length > 0;
    const successRepos = input.codeResult.perRepo.filter((r) => r.status === 'success');

    const urls = await Promise.all(
      successRepos.map((repo) => {
        const title = hasQAFailures
          ? `[QA FAILING] ${input.taskSpec.goal}`
          : input.taskSpec.goal;
        const body = this.buildPRBody(input, repo.repo, hasQAFailures);
        return this.deps.openPR({ repo: repo.repo, branch: repo.branch, title, body });
      })
    );

    return urls;
  }

  private buildPRBody(input: PRInput, repo: string, hasQAFailures: boolean): string {
    const plan = input.changePlan.perRepo.find((p) => p.repo === repo);
    const lines = [
      `## Goal\n${input.taskSpec.goal}`,
      `## Acceptance Criteria\n${input.taskSpec.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}`,
      `## Changes\n${(plan?.changes ?? []).map((c) => `- ${c}`).join('\n')}`,
    ];

    if (hasQAFailures) {
      lines.push(`## QA Failures\n${input.qaReport.failed.map((f) => `- ${f.testCase.useCase}: ${f.reason}`).join('\n')}`);
    } else {
      lines.push(`## QA\n✅ All test cases passed.`);
    }

    return lines.join('\n\n');
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/agents && pnpm test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/pr-agent.ts packages/agents/src/test/pr-agent.test.ts
git commit -m "feat(agents): add PRAgent"
```

---

## Phase 3: QA Pipeline Agents

> Can be executed in parallel with Phase 2 after Phase 1 is complete.

### Task 10: AuthGuard (pre-stage 5 credential check)

**Files:**
- Create: `packages/agents/src/auth-guard.ts`
- Create: `packages/agents/src/test/auth-guard.test.ts`

The spec requires credentials to be checked lazily at the start of stage 5 (before `EnvSetupAgent` runs). The `@muggleai/mcp` package exposes `getValidCredentials`, `startDeviceCodeFlow`, and `getCallerCredentialsAsync` — use these directly.

- [ ] **Step 1: Write failing test**

```typescript
// packages/agents/src/test/auth-guard.test.ts
import { describe, it, expect, vi } from 'vitest';
import { AuthGuard } from '../auth-guard.js';

describe('AuthGuard', () => {
  it('resolves immediately when credentials are valid', async () => {
    const getCredentials = vi.fn().mockResolvedValue({ accessToken: 'tok', expiresAt: Date.now() + 9999 });
    const guard = new AuthGuard({ getCredentials, startDeviceFlow: vi.fn(), refreshToken: vi.fn() });
    await expect(guard.ensureAuthenticated()).resolves.toBeUndefined();
    expect(getCredentials).toHaveBeenCalledOnce();
  });

  it('triggers device code flow when credentials are missing', async () => {
    const getCredentials = vi.fn().mockResolvedValue(null);
    const startDeviceFlow = vi.fn().mockResolvedValue(undefined);
    const guard = new AuthGuard({ getCredentials, startDeviceFlow, refreshToken: vi.fn() });
    await guard.ensureAuthenticated();
    expect(startDeviceFlow).toHaveBeenCalledOnce();
  });

  it('refreshes token when credentials are expired but refresh token valid', async () => {
    const getCredentials = vi.fn().mockResolvedValue({ accessToken: 'tok', expiresAt: Date.now() - 1, refreshToken: 'rt' });
    const refreshToken = vi.fn().mockResolvedValue(undefined);
    const guard = new AuthGuard({ getCredentials, startDeviceFlow: vi.fn(), refreshToken });
    await guard.ensureAuthenticated();
    expect(refreshToken).toHaveBeenCalledOnce();
  });

  it('throws AuthError if device flow fails', async () => {
    const getCredentials = vi.fn().mockResolvedValue(null);
    const startDeviceFlow = vi.fn().mockRejectedValue(new Error('network error'));
    const guard = new AuthGuard({ getCredentials, startDeviceFlow, refreshToken: vi.fn() });
    await expect(guard.ensureAuthenticated()).rejects.toThrow('network error');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd packages/agents && pnpm test
```
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// packages/agents/src/auth-guard.ts

export interface StoredCredentials {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
}

export interface AuthGuardDeps {
  getCredentials: () => Promise<StoredCredentials | null>;
  startDeviceFlow: () => Promise<void>;
  refreshToken: (token: string) => Promise<void>;
}

export class AuthGuard {
  constructor(private readonly deps: AuthGuardDeps) {}

  async ensureAuthenticated(): Promise<void> {
    const creds = await this.deps.getCredentials();

    if (!creds) {
      await this.deps.startDeviceFlow();
      return;
    }

    if (creds.expiresAt <= Date.now()) {
      if (creds.refreshToken) {
        await this.deps.refreshToken(creds.refreshToken);
      } else {
        await this.deps.startDeviceFlow();
      }
    }
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/agents && pnpm test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/auth-guard.ts packages/agents/src/test/auth-guard.test.ts
git commit -m "feat(agents): add AuthGuard for lazy pre-QA credential check"
```

---

### Task 11: EnvSetupAgent

**Files:**
- Create: `packages/agents/src/env-setup-agent.ts`
- Create: `packages/agents/src/test/env-setup-agent.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/agents/src/test/env-setup-agent.test.ts
import { describe, it, expect, vi } from 'vitest';
import { EnvSetupAgent } from '../env-setup-agent.js';
import type { ChangePlan } from '@muggleai/workflows';

const plan: ChangePlan = {
  resolvedRepos: ['frontend', 'auth-service'],
  perRepo: [
    { repo: 'frontend', changes: [], files: [], requiredForQA: true },
    { repo: 'auth-service', changes: [], files: [], requiredForQA: true },
  ],
};

describe('EnvSetupAgent', () => {
  it('returns EnvState with started services', async () => {
    const discoverServices = vi.fn().mockResolvedValue([{ name: 'auth-service', startCommand: 'pnpm dev' }]);
    const startService = vi.fn().mockResolvedValue({ name: 'auth-service', pid: 1234 });
    const agent = new EnvSetupAgent({ discoverServices, startService });
    const state = await agent.run(plan);

    expect(state.services).toHaveLength(1);
    expect(state.services[0].name).toBe('auth-service');
    expect(state.services[0].pid).toBe(1234);
  });

  it('calls discoverServices with the change plan', async () => {
    const discoverServices = vi.fn().mockResolvedValue([]);
    const agent = new EnvSetupAgent({ discoverServices, startService: vi.fn() });
    await agent.run(plan);
    expect(discoverServices).toHaveBeenCalledWith(plan);
  });

  it('throws if a required service fails to start', async () => {
    const discoverServices = vi.fn().mockResolvedValue([{ name: 'auth-service', startCommand: 'pnpm dev', required: true }]);
    const startService = vi.fn().mockRejectedValue(new Error('port in use'));
    const agent = new EnvSetupAgent({ discoverServices, startService });
    await expect(agent.run(plan)).rejects.toThrow('port in use');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd packages/agents && pnpm test
```
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// packages/agents/src/env-setup-agent.ts
import type { ChangePlan, EnvState, ServiceHandle } from '@muggleai/workflows';
import type { IAgent } from './types.js';

export interface ServiceDescriptor {
  name: string;
  startCommand: string;
  required?: boolean;
}

export interface EnvSetupAgentDeps {
  discoverServices: (plan: ChangePlan) => Promise<ServiceDescriptor[]>;
  startService: (descriptor: ServiceDescriptor) => Promise<ServiceHandle>;
}

export class EnvSetupAgent implements IAgent<ChangePlan, EnvState> {
  constructor(private readonly deps: EnvSetupAgentDeps) {}

  async run(plan: ChangePlan): Promise<EnvState> {
    const descriptors = await this.deps.discoverServices(plan);
    const services: ServiceHandle[] = [];

    for (const descriptor of descriptors) {
      const handle = await this.deps.startService(descriptor);
      services.push(handle);
    }

    return { services };
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/agents && pnpm test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/env-setup-agent.ts packages/agents/src/test/env-setup-agent.test.ts
git commit -m "feat(agents): add EnvSetupAgent"
```

---

### Task 12: TestScopeAgent

**Files:**
- Create: `packages/agents/src/test-scope-agent.ts`
- Create: `packages/agents/src/test/test-scope-agent.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/agents/src/test/test-scope-agent.test.ts
import { describe, it, expect, vi } from 'vitest';
import { TestScopeAgent } from '../test-scope-agent.js';
import type { ChangePlan } from '@muggleai/workflows';

const plan: ChangePlan = {
  resolvedRepos: ['frontend'],
  perRepo: [{ repo: 'frontend', changes: ['Add login page'], files: ['src/Login.tsx'], requiredForQA: true }],
};

describe('TestScopeAgent', () => {
  it('returns TestManifest with typed TestCaseRef entries', async () => {
    const mockLlm = vi.fn().mockResolvedValue({
      testCases: [{ id: 'tc-001', useCase: 'Login', description: 'User can log in' }],
    });
    const agent = new TestScopeAgent({ llm: mockLlm, fetchAllTestCases: vi.fn().mockResolvedValue([]) });
    const manifest = await agent.run({ changePlan: plan });

    expect(manifest.testCases).toHaveLength(1);
    expect(manifest.testCases[0].id).toBe('tc-001');
  });

  it('passes full test case list and change plan to LLM', async () => {
    const allTests = [{ id: 'tc-001', useCase: 'Login', description: 'test' }];
    const mockLlm = vi.fn().mockResolvedValue({ testCases: [] });
    const agent = new TestScopeAgent({ llm: mockLlm, fetchAllTestCases: vi.fn().mockResolvedValue(allTests) });
    await agent.run({ changePlan: plan });

    expect(mockLlm).toHaveBeenCalledWith(expect.stringContaining('tc-001'));
    expect(mockLlm).toHaveBeenCalledWith(expect.stringContaining('Add login page'));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd packages/agents && pnpm test
```
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// packages/agents/src/test-scope-agent.ts
import type { ChangePlan, TestManifest, TestCaseRef } from '@muggleai/workflows';
import type { IAgent } from './types.js';

export interface TestScopeInput {
  changePlan: ChangePlan;
  previousQAReport?: { failedTestIds: string[] };
}

export interface TestScopeAgentDeps {
  llm: (prompt: string) => Promise<TestManifest>;
  fetchAllTestCases: () => Promise<TestCaseRef[]>;
}

export class TestScopeAgent implements IAgent<TestScopeInput, TestManifest> {
  constructor(private readonly deps: TestScopeAgentDeps) {}

  async run(input: TestScopeInput): Promise<TestManifest> {
    const allTests = await this.deps.fetchAllTestCases();
    const changedFiles = input.changePlan.perRepo.flatMap((r) => r.files);
    const changes = input.changePlan.perRepo.flatMap((r) => r.changes);

    const prompt = `You are a QA engineer. Select which test cases to run based on the code changes.

Changed files: ${changedFiles.join(', ')}
Change descriptions: ${changes.join(', ')}

All available test cases:
${allTests.map((t) => `- id: ${t.id}, useCase: ${t.useCase}, description: ${t.description}`).join('\n')}

Select only the test cases impacted by the changes. Respond with JSON: { testCases: TestCaseRef[], skipReason?: string }`;

    return this.deps.llm(prompt);
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/agents && pnpm test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/test-scope-agent.ts packages/agents/src/test/test-scope-agent.test.ts
git commit -m "feat(agents): add TestScopeAgent"
```

---

### Task 13: QAAgent

**Files:**
- Create: `packages/agents/src/qa-agent.ts`
- Create: `packages/agents/src/test/qa-agent.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/agents/src/test/qa-agent.test.ts
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
    const runTestCase = vi.fn()
      .mockResolvedValueOnce({ passed: true })
      .mockResolvedValueOnce({ passed: true });

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
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd packages/agents && pnpm test
```
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// packages/agents/src/qa-agent.ts
import type { TestManifest, QAReport, TestCaseRef } from '@muggleai/workflows';
import type { IAgent } from './types.js';

export interface TestCaseRunResult {
  passed: boolean;
  reason?: string;
  repro?: string;
}

export interface QAAgentDeps {
  runTestCase: (testCase: TestCaseRef) => Promise<TestCaseRunResult>;
}

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
      failed: results
        .filter((r) => !r.result.passed)
        .map((r) => ({
          testCase: r.testCase,
          reason: r.result.reason ?? 'unknown',
          repro: r.result.repro ?? '',
        })),
    };
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/agents && pnpm test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/qa-agent.ts packages/agents/src/test/qa-agent.test.ts
git commit -m "feat(agents): add QAAgent"
```

---

## Phase 4: Integration

### Task 14: Agents index.ts

**Files:**
- Create: `packages/agents/src/index.ts`

- [ ] **Step 1: Write and verify**

```typescript
// packages/agents/src/index.ts
export * from './types.js';
export * from './requirements-agent.js';
export * from './impact-analysis-agent.js';
export * from './coding-agent.js';
export * from './unit-test-runner.js';
export * from './auth-guard.js';
export * from './env-setup-agent.js';
export * from './test-scope-agent.js';
export * from './qa-agent.js';
export * from './pr-agent.js';
```

- [ ] **Step 2: Run all agent tests**

```bash
cd packages/agents && pnpm test
```
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/agents/src/index.ts
git commit -m "feat(agents): export all agents from index"
```

---

### Task 15: Dev Cycle Workflow Definition

**Files:**
- Create: `packages/workflows/src/dev-cycle.ts`

This wires all stages together into the full dev cycle DAG using `WorkflowRunner`.

- [ ] **Step 1: Write the dev cycle workflow**

```typescript
// packages/workflows/src/dev-cycle.ts
import type {
  TaskSpec, ChangePlan, CodeResult, UnitTestResult,
  EnvState, TestManifest, QAReport, PRInput,
} from './contracts.js';
import { WorkflowRunner } from './runner.js';
import type { WorkflowConfig } from './config.js';

export interface DevCycleAgents {
  requirements: (prompt: string) => Promise<TaskSpec>;
  impactAnalysis: (spec: TaskSpec) => Promise<ChangePlan>;
  coding: (plan: ChangePlan, retryCount: number, failures: string[]) => Promise<CodeResult>;
  unitTests: (code: CodeResult) => Promise<UnitTestResult>;
  ensureAuth: () => Promise<void>;          // AuthGuard.ensureAuthenticated — called once before stage 5
  envSetup: (plan: ChangePlan) => Promise<EnvState>;
  testScope: (plan: ChangePlan) => Promise<TestManifest>;
  qa: (manifest: TestManifest) => Promise<QAReport>;
  openPRs: (input: PRInput) => Promise<string[]>;
  teardown: (env: EnvState) => Promise<void>;
}

export interface DevCycleResult {
  prUrls: string[];
  qaReport: QAReport;
}

export async function runDevCycle(
  userPrompt: string,
  agents: DevCycleAgents,
  config: WorkflowConfig
): Promise<DevCycleResult> {
  const runner = new WorkflowRunner(config);
  const state = runner.createState();

  // Stage 1: Requirements
  const taskSpec = await agents.requirements(userPrompt);

  // Stage 2: Impact Analysis
  const changePlan = await agents.impactAnalysis(taskSpec);

  let codeResult: CodeResult | null = null;
  let unitTestResult: UnitTestResult | null = null;
  let qaReport: QAReport | null = null;
  const failures: string[] = [];

  // Retry loop: stages 3–7
  while (true) {
    // Stage 3: Coding (parallel across repos)
    codeResult = await agents.coding(changePlan, state.retryCount, failures);

    // Halt if a required-for-QA repo failed coding
    const requiredFailed = changePlan.perRepo.find(
      (r) => r.requiredForQA && codeResult!.perRepo.find((cr) => cr.repo === r.repo)?.status === 'failed'
    );
    if (requiredFailed) {
      throw new Error(`Required repo "${requiredFailed.repo}" failed to implement changes.`);
    }

    // Stage 4: Unit Tests
    unitTestResult = await agents.unitTests(codeResult);
    const allPassed = unitTestResult.perRepo.every((r) => r.passed);

    if (!allPassed) {
      if (runner.isMaxRetriesExceeded(state)) {
        // Teardown if env was started on a previous retry iteration
        if (state.envStarted) {
          const envState = state.stageResults.get('env-setup' as never)?.output as EnvState;
          if (envState) await agents.teardown(envState);
        }
        throw new Error(`Unit tests failed after ${state.retryCount} retries.`);
      }
      failures.push(...unitTestResult.perRepo.filter((r) => !r.passed).map((r) => r.output));
      runner.recordRetry(state);
      continue;
    }

    // Stage 5: Auth check (lazy — only on first pass) then Env Setup
    if (!state.envStarted) {
      await agents.ensureAuth();            // halts with thrown error if auth fails
      const envState = await agents.envSetup(changePlan);
      state.envStarted = true;
      state.stageResults.set('env-setup' as never, { stage: 'env-setup' as never, status: 'succeeded', output: envState });
    }
    const envState = state.stageResults.get('env-setup' as never)?.output as EnvState;

    // Stage 6: Test Scope
    const manifest = await agents.testScope(changePlan);

    // Stage 7: QA
    qaReport = await agents.qa(manifest);

    if (qaReport.failed.length === 0) break; // QA passed

    if (runner.isMaxRetriesExceeded(state)) {
      if (runner.shouldOpenPRsOnFailure()) {
        // requireQAPass: false — teardown first, then open PRs (spec: "teardown runs first")
        if (state.envStarted) { await agents.teardown(envState); state.tornDown = true; }
        break;
      }
      if (state.envStarted) await agents.teardown(envState);
      throw new Error(`QA failed after ${state.retryCount} retries.`);
    }

    failures.push(...qaReport.failed.map((f) => `${f.testCase.useCase}: ${f.reason}`));
    runner.recordRetry(state);
  }

  const envState = state.stageResults.get('env-setup' as never)?.output as EnvState | undefined;

  // Stage 8: Open PRs
  const prUrls = await agents.openPRs({
    taskSpec,
    changePlan,
    codeResult: codeResult!,
    qaReport: qaReport!,
  });

  // Stage 9: Teardown (only if not already torn down on requireQAPass: false exit)
  if (envState && !state.tornDown) await agents.teardown(envState);

  return { prUrls, qaReport: qaReport! };
}
```

- [ ] **Step 2: Write integration test for the happy path**

```typescript
// packages/workflows/src/dev-cycle.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runDevCycle } from './dev-cycle.js';
import { defaultConfig } from './config.js';
import type { DevCycleAgents } from './dev-cycle.js';

function makeAgents(overrides: Partial<DevCycleAgents> = {}): DevCycleAgents {
  return {
    requirements: vi.fn().mockResolvedValue({ goal: 'Add login', acceptanceCriteria: [], hintedRepos: [] }),
    impactAnalysis: vi.fn().mockResolvedValue({
      resolvedRepos: ['frontend'],
      perRepo: [{ repo: 'frontend', changes: [], files: [], requiredForQA: true }],
    }),
    coding: vi.fn().mockResolvedValue({
      perRepo: [{ repo: 'frontend', branch: 'feat/login', diff: '', status: 'success' }],
    }),
    unitTests: vi.fn().mockResolvedValue({ perRepo: [{ repo: 'frontend', passed: true, output: '', failedTests: [] }] }),
    ensureAuth: vi.fn().mockResolvedValue(undefined),
    envSetup: vi.fn().mockResolvedValue({ services: [{ name: 'frontend' }] }),
    testScope: vi.fn().mockResolvedValue({ testCases: [{ id: 'tc-1', useCase: 'Login', description: '' }] }),
    qa: vi.fn().mockResolvedValue({ passed: [{ id: 'tc-1', useCase: 'Login', description: '' }], failed: [] }),
    openPRs: vi.fn().mockResolvedValue(['https://github.com/org/repo/pull/1']),
    teardown: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('runDevCycle', () => {
  it('runs all stages and returns PR URLs on happy path', async () => {
    const agents = makeAgents();
    const result = await runDevCycle('Add login feature', agents, defaultConfig);

    expect(result.prUrls).toEqual(['https://github.com/org/repo/pull/1']);
    expect(result.qaReport.failed).toHaveLength(0);
    expect(agents.teardown).toHaveBeenCalled();
  });

  it('retries coding when unit tests fail', async () => {
    const coding = vi.fn().mockResolvedValue({
      perRepo: [{ repo: 'frontend', branch: 'feat/login', diff: '', status: 'success' }],
    });
    const unitTests = vi.fn()
      .mockResolvedValueOnce({ perRepo: [{ repo: 'frontend', passed: false, output: 'test failed', failedTests: [] }] })
      .mockResolvedValue({ perRepo: [{ repo: 'frontend', passed: true, output: '', failedTests: [] }] });

    const agents = makeAgents({ coding, unitTests });
    await runDevCycle('Add login feature', agents, defaultConfig);

    expect(coding).toHaveBeenCalledTimes(2);
  });

  it('halts if required repo coding fails', async () => {
    const agents = makeAgents({
      coding: vi.fn().mockResolvedValue({
        perRepo: [{ repo: 'frontend', branch: '', diff: '', status: 'failed', error: 'compile error' }],
      }),
    });
    await expect(runDevCycle('Add login feature', agents, defaultConfig)).rejects.toThrow('Required repo');
  });

  it('tears down env if unit tests fail at max retries after env was started', async () => {
    // Retry 1: unit tests pass → env starts → QA fails
    // Retry 2: unit tests fail at max retries → teardown must run
    const unitTests = vi.fn()
      .mockResolvedValueOnce({ perRepo: [{ repo: 'frontend', passed: true, output: '', failedTests: [] }] }) // retry 1 passes
      .mockResolvedValue({ perRepo: [{ repo: 'frontend', passed: false, output: 'fail', failedTests: [] }] }); // retry 2 fails
    const qa = vi.fn().mockResolvedValue({
      passed: [],
      failed: [{ testCase: { id: 'tc-1', useCase: 'Login', description: '' }, reason: 'timeout', repro: '' }],
    });
    const agents = makeAgents({ unitTests, qa });
    await expect(
      runDevCycle('Add login feature', agents, { ...defaultConfig, maxRetries: 2 })
    ).rejects.toThrow('Unit tests failed');
    expect(agents.teardown).toHaveBeenCalled();
  });

  it('opens PRs and tears down before them when requireQAPass: false and QA fails', async () => {
    const qa = vi.fn().mockResolvedValue({
      passed: [],
      failed: [{ testCase: { id: 'tc-1', useCase: 'Login', description: '' }, reason: 'timeout', repro: '' }],
    });
    const teardown = vi.fn().mockResolvedValue(undefined);
    const openPRs = vi.fn().mockResolvedValue(['https://github.com/org/repo/pull/1']);
    const agents = makeAgents({ qa, teardown, openPRs });
    const result = await runDevCycle('Add login', agents, { ...defaultConfig, requireQAPass: false, maxRetries: 1 });

    // teardown must be called before openPRs
    const teardownCall = teardown.mock.invocationCallOrder[0];
    const openPRsCall = openPRs.mock.invocationCallOrder[0];
    expect(teardownCall).toBeLessThan(openPRsCall);
    expect(result.prUrls).toHaveLength(1);
    // teardown should only be called once
    expect(teardown).toHaveBeenCalledTimes(1);
  });

  it('does not start env twice across retries', async () => {
    const unitTests = vi.fn()
      .mockResolvedValueOnce({ perRepo: [{ repo: 'frontend', passed: false, output: '', failedTests: [] }] })
      .mockResolvedValue({ perRepo: [{ repo: 'frontend', passed: true, output: '', failedTests: [] }] });
    const agents = makeAgents({ unitTests });
    await runDevCycle('Add login feature', agents, defaultConfig);

    expect(agents.envSetup).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd packages/workflows && pnpm test
```
Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/workflows/src/dev-cycle.ts packages/workflows/src/dev-cycle.test.ts
git commit -m "feat(workflows): add dev cycle workflow with retry logic"
```

---

### Task 16: Workflows Runner Entrypoint

**Files:**
- Create: `apps/workflows-runner/src/index.ts`
- Modify: `apps/workflows-runner/package.json`

- [ ] **Step 1: Update apps/workflows-runner/package.json**

```json
{
  "name": "@muggleai/workflows-runner",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "build": "tsc --noEmit",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "eslint ."
  },
  "dependencies": {
    "@muggleai/agents": "workspace:*",
    "@muggleai/mcp": "workspace:*",
    "@muggleai/workflows": "workspace:*",
    "tsx": "*"
  }
}
```

- [ ] **Step 2: Implement the entrypoint**

```typescript
// apps/workflows-runner/src/index.ts
import { runDevCycle } from '@muggleai/workflows';
import { mergeConfig } from '@muggleai/workflows';
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
  // Each agent below is a stub — replace with real implementations
  // that call @muggleai/agents classes with live LLM/tool dependencies
  const agents: DevCycleAgents = {
    requirements: async (_prompt) => { throw new Error('Not implemented'); },
    impactAnalysis: async (_spec) => { throw new Error('Not implemented'); },
    coding: async (_plan, _retry, _failures) => { throw new Error('Not implemented'); },
    unitTests: async (_code) => { throw new Error('Not implemented'); },
    ensureAuth: async () => { throw new Error('Not implemented'); },  // wire AuthGuard here
    envSetup: async (_plan) => { throw new Error('Not implemented'); },
    testScope: async (_plan) => { throw new Error('Not implemented'); },
    qa: async (_manifest) => { throw new Error('Not implemented'); },
    openPRs: async (_input) => { throw new Error('Not implemented'); },
    teardown: async (_env) => { return; },
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
```

- [ ] **Step 3: Run workspace typecheck**

```bash
pnpm typecheck:workspace
```
Expected: no type errors.

- [ ] **Step 4: Run all workspace tests**

```bash
pnpm test:workspace
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/workflows-runner/
git commit -m "feat(workflows-runner): add entrypoint with agent wiring stubs"
```

---

## Done

At this point:
- All data contracts are defined and tested
- WorkflowRunner handles retry logic, halt conditions, and QA failure branching
- All 8 agents are implemented with unit tests
- The dev cycle workflow wires all stages together
- The runner entrypoint is ready to receive real agent implementations

**Next step:** Wire real LLM calls and tool dependencies into the agent stubs in `apps/workflows-runner/src/index.ts` using `@muggleai/agents` classes and `@muggleai/mcp` tools.
