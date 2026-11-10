import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { executeQaTool } = vi.hoisted(() => ({ executeQaTool: vi.fn() }));

vi.mock("../../../packages/mcps/src/index.js", () => ({
  e2e: { executeQaTool: executeQaTool, PRICING_GET_TOOL_NAME: "muggle-remote-pricing-get" },
}));

import { pricingCommand, renderPricingText } from "../../cli/pricing.js";

const pricingCatalog = {
  catalogVersion: "2026-10",
  plans: [
    {
      planId: "FREE",
      name: "Free",
      description: "",
      monthlyPriceUsd: 0,
      isPerSeat: false,
      minimumSeats: null,
      concurrentWorkflows: 1,
      includedTokens: 1_000_000,
      tokenGrantCadence: "ONE_TIME",
      featureDescriptions: [],
    },
    {
      planId: "PROFESSIONAL",
      name: "Professional",
      description: "",
      monthlyPriceUsd: 60,
      isPerSeat: true,
      minimumSeats: 4,
      concurrentWorkflows: 10,
      includedTokens: 0,
      tokenGrantCadence: null,
      featureDescriptions: [],
    },
  ],
  tokenPackages: [{ packageId: "starter_5000", name: "Starter", tokens: 5_000_000, priceUsd: 25 }],
  tokenPriceUsdPerMillion: 5,
};

describe("renderPricingText", () => {
  it("prints one line per plan and package, with the token price", () => {
    expect(renderPricingText(pricingCatalog).split("\n")).toEqual([
      "Muggle AI pricing (catalog 2026-10)",
      "",
      "Plans",
      "  Free          $0/mo · 1 concurrent workflow · 1M tokens one time",
      "  Professional  $60/seat/mo, min 4 seats · 10 concurrent workflows · no included tokens",
      "",
      "Token packages",
      "  Starter  5M tokens · $25  (starter_5000)",
      "",
      "Tokens cost $5 per million.",
    ]);
  });
});

describe("pricingCommand", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    executeQaTool.mockReset();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.exitCode = undefined;
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    process.exitCode = undefined;
  });

  it("reads the catalog through the pricing tool", async () => {
    executeQaTool.mockResolvedValueOnce({ content: JSON.stringify(pricingCatalog), isError: false });
    await pricingCommand({});
    expect(executeQaTool).toHaveBeenCalledWith("muggle-remote-pricing-get", {}, expect.any(String));
    expect(logSpy).toHaveBeenCalledWith(renderPricingText(pricingCatalog));
  });

  it("prints the tool's JSON with --json", async () => {
    const catalogJson = JSON.stringify(pricingCatalog, null, 2);
    executeQaTool.mockResolvedValueOnce({ content: catalogJson, isError: false });
    await pricingCommand({ json: true });
    expect(logSpy).toHaveBeenCalledWith(catalogJson);
  });

  it("reports a failed read and exits 1", async () => {
    executeQaTool.mockResolvedValueOnce({
      content: JSON.stringify({ error: "UPSTREAM_ERROR", message: "The service is temporarily unavailable." }),
      isError: true,
    });
    await pricingCommand({});
    expect(errorSpy).toHaveBeenCalledWith("Could not load pricing: The service is temporarily unavailable.");
    expect(process.exitCode).toBe(1);
  });
});
