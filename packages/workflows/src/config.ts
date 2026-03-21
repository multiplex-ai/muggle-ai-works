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
