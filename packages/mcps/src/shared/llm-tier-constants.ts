import { LlmTierEnum } from "./llm-tier-types.js";

/** User-facing label of each model tier, matching the dashboard and pricing. */
export const LLM_TIER_DISPLAY_LABELS: Record<LlmTierEnum, string> = {
  [LlmTierEnum.Standard]: "Premium",
  [LlmTierEnum.Light]: "Standard",
};

/** Model each tier runs Studio's prediction agent on. */
export const LLM_TIER_MODEL_NAMES: Record<LlmTierEnum, string> = {
  [LlmTierEnum.Standard]: "Claude Opus 5.5",
  [LlmTierEnum.Light]: "Claude Sonnet 5.5",
};

const LIGHT_TIER_SUMMARY = `the ${LLM_TIER_DISPLAY_LABELS[LlmTierEnum.Light]} tier (${LLM_TIER_MODEL_NAMES[LlmTierEnum.Light]}, faster and lower cost)`;
const DEFAULT_TIER_SUMMARY = `the ${LLM_TIER_DISPLAY_LABELS[LlmTierEnum.Standard]} tier (${LLM_TIER_MODEL_NAMES[LlmTierEnum.Standard]}, the default)`;

/** Agent-facing description of the remote `workflowParams.llm` override. */
export const WORKFLOW_LLM_PARAMS_DESCRIPTION =
  `Model tier override. tier '${LlmTierEnum.Light}' runs ${LIGHT_TIER_SUMMARY}; tier '${LlmTierEnum.Standard}' runs ${DEFAULT_TIER_SUMMARY}. Omit to inherit the project/use case/test case setting.`;

/** Agent-facing description of the local `lightMode` flag. */
export const LIGHT_MODE_INPUT_DESCRIPTION =
  `true runs ${LIGHT_TIER_SUMMARY}. Default false runs ${DEFAULT_TIER_SUMMARY}.`;
