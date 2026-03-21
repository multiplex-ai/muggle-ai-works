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
