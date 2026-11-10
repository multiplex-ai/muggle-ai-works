/**
 * `muggle pricing` CLI handler.
 *
 * Prints Muggle AI's plans, token price and token packages from the live backend catalog, the same
 * data the `muggle-remote-pricing-get` MCP tool returns. No sign-in needed.
 */

import { randomUUID } from "node:crypto";

import { e2e } from "@muggleai/mcp";
import { TOKENS_PER_MILLION } from "./pricing-constants.js";
import type { IPricingCommandOptions } from "./pricing-types.js";

function formatUsd(amountUsd: number): string {
  return Number.isInteger(amountUsd) ? `$${amountUsd}` : `$${amountUsd.toFixed(2)}`;
}

function formatTokens(tokens: number): string {
  return `${(tokens / TOKENS_PER_MILLION).toLocaleString("en-US", { maximumFractionDigits: 1 })}M`;
}

function formatPlanPrice(plan: e2e.IPricingPlan): string {
  if (!plan.isPerSeat) {
    return `${formatUsd(plan.monthlyPriceUsd)}/mo`;
  }
  const seatFloor = plan.minimumSeats ? `, min ${plan.minimumSeats} seats` : "";
  return `${formatUsd(plan.monthlyPriceUsd)}/seat/mo${seatFloor}`;
}

function formatIncludedTokens(plan: e2e.IPricingPlan): string {
  if (plan.includedTokens <= 0) {
    return "no included tokens";
  }
  const cadence = plan.tokenGrantCadence ? ` ${plan.tokenGrantCadence.toLowerCase().replace(/_/g, " ")}` : "";
  return `${formatTokens(plan.includedTokens)} tokens${cadence}`;
}

/**
 * Render the catalog as terminal text: one line per plan, then one per token package.
 * @param catalog - Output of `muggle-remote-pricing-get`.
 * @returns Printable text.
 */
export function renderPricingText(catalog: e2e.IPricingCatalogOutput): string {
  const lines = [`Muggle AI pricing${catalog.catalogVersion ? ` (catalog ${catalog.catalogVersion})` : ""}`, "", "Plans"];
  const planNameWidth = Math.max(0, ...catalog.plans.map((plan) => plan.name.length));
  for (const plan of catalog.plans) {
    const workflows = `${plan.concurrentWorkflows} concurrent workflow${plan.concurrentWorkflows === 1 ? "" : "s"}`;
    lines.push(`  ${plan.name.padEnd(planNameWidth)}  ${formatPlanPrice(plan)} · ${workflows} · ${formatIncludedTokens(plan)}`);
  }
  if (catalog.tokenPackages.length > 0) {
    lines.push("", "Token packages");
    const packageNameWidth = Math.max(...catalog.tokenPackages.map((tokenPackage) => tokenPackage.name.length));
    for (const tokenPackage of catalog.tokenPackages) {
      lines.push(
        `  ${tokenPackage.name.padEnd(packageNameWidth)}  ${formatTokens(tokenPackage.tokens)} tokens · ${formatUsd(tokenPackage.priceUsd)}  (${tokenPackage.packageId})`,
      );
    }
  }
  if (catalog.tokenPriceUsdPerMillion !== null) {
    lines.push("", `Tokens cost ${formatUsd(catalog.tokenPriceUsdPerMillion)} per million.`);
  }
  return lines.join("\n");
}

/**
 * Fetch the live pricing catalog and print it.
 *
 * Exits 1 when the backend cannot be reached or answers with an error.
 *
 * @param options - `--json`.
 */
export async function pricingCommand(options: IPricingCommandOptions = {}): Promise<void> {
  const toolResult = await e2e.executeQaTool(e2e.PRICING_GET_TOOL_NAME, {}, randomUUID());
  if (toolResult.isError) {
    const failure = JSON.parse(String(toolResult.content)) as { message?: string };
    console.error(`Could not load pricing: ${failure.message ?? String(toolResult.content)}`);
    process.exitCode = 1;
    return;
  }
  if (options.json) {
    console.log(toolResult.content);
    return;
  }
  console.log(renderPricingText(JSON.parse(String(toolResult.content)) as e2e.IPricingCatalogOutput));
}
