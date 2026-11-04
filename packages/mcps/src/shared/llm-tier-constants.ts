import { LlmTierEnum } from "./llm-tier-types.js";

/** Agent-facing description of the remote `workflowParams.llm` override. */
export const WORKFLOW_LLM_PARAMS_DESCRIPTION =
  "Set tier to 'light' to run Studio in Light mode — a faster, lower-cost model (Claude Sonnet 5.5). Omit to inherit the project/use case/test case setting.";

/** Agent-facing description of the local `lightMode` flag. */
export const LIGHT_MODE_INPUT_DESCRIPTION =
  "Run Studio in Light mode — faster, lower-cost model (Claude Sonnet 5.5). Default false.";

/** User-facing label of each model tier, shown in run summaries. */
export const LLM_TIER_DISPLAY_LABELS: Record<LlmTierEnum, string> = {
  [LlmTierEnum.Standard]: "Standard",
  [LlmTierEnum.Light]: "Light mode",
};
