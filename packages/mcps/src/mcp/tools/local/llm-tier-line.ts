import { LLM_TIER_DISPLAY_LABELS } from "../../../shared/llm-tier-constants.js";
import { LlmTierEnum } from "../../../shared/llm-tier-types.js";

/**
 * Format a local run's `**Model tier:**` report line from the tier the run requested.
 *
 * @param isLightMode - Whether the run was started in Light mode.
 * @returns The report line.
 *
 * Output shape: `**Model tier:** Light mode`
 */
export function formatLlmTierLine(isLightMode: boolean | undefined): string {
  const llmTier = isLightMode === true ? LlmTierEnum.Light : LlmTierEnum.Standard;
  return `**Model tier:** ${LLM_TIER_DISPLAY_LABELS[llmTier]}`;
}
