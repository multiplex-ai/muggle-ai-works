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
