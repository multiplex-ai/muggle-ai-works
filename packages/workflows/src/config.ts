export interface WorkflowConfig {
  requireQAPass: boolean;
}

export const defaultConfig: WorkflowConfig = {
  requireQAPass: true,
};

export function mergeConfig(partial: Partial<WorkflowConfig>): WorkflowConfig {
  return { ...defaultConfig, ...partial };
}
