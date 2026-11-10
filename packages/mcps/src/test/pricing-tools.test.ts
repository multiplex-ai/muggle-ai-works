/**
 * Tests for muggle-remote-pricing-get, which reads the public product catalog, and
 * muggle-remote-wallet-package-list, which lists the packageIds muggle-remote-wallet-topup takes.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../shared/config.js", () => ({
  getConfig: () => ({
    logLevel: "silent",
    serverName: "test",
    serverVersion: "0.0.0",
    e2e: { promptServiceBaseUrl: "http://test.invalid", requestTimeoutMs: 1000, workflowTimeoutMs: 1000 },
  }),
}));

vi.mock("../shared/logger.js", () => {
  const noop = () => undefined;
  const fakeLogger = { info: noop, warn: noop, error: noop, debug: noop, verbose: noop, silly: noop, child: () => fakeLogger };
  return { getLogger: () => fakeLogger, createChildLogger: () => fakeLogger, resetLogger: noop };
});

const mockExecute = vi.fn();
vi.mock("../mcp/e2e/upstream-client.js", () => ({
  getPromptServiceClient: () => ({ execute: mockExecute }),
}));

const mockGetCallerCredentials = vi.fn();
vi.mock("../shared/auth.js", () => ({
  getCallerCredentialsAsync: () => mockGetCallerCredentials(),
}));

import { executeQaTool, getQaToolByName } from "../mcp/tools/e2e/tool-registry.js";

const PRICING_TOOL_NAME = "muggle-remote-pricing-get";
const PACKAGE_LIST_TOOL_NAME = "muggle-remote-wallet-package-list";

const productCatalog = {
  version: "2026-10",
  tiers: {
    ENTERPRISE: {
      id: "ENTERPRISE",
      name: "Enterprise",
      description: "For teams",
      pricing: { monthly: 50, perSeat: false, stripePriceLookupKey: "enterprise_monthly" },
      quota: { concurrentWorkflows: 20, monthlyTokens: 0, seats: 20 },
      features: { cicd: true },
      featureDescriptions: ["From 20 concurrent workflows"],
    },
    FREE: {
      id: "FREE",
      name: "Free",
      pricing: { monthly: 0, perSeat: false, stripePriceLookupKey: "free_monthly" },
      quota: { concurrentWorkflows: 1, monthlyTokens: 1_000_000, tokenGrantCadence: "ONE_TIME" },
      features: { cicd: false },
    },
  },
  tokenPackages: {
    pro_10000: { id: "pro_10000", displayName: "Pro", tokens: 10_000_000, priceUsd: 50, stripePriceLookupKey: "pro_lookup" },
    starter_5000: { id: "starter_5000", displayName: "Starter", tokens: 5_000_000, priceUsd: 25, stripePriceLookupKey: "starter_lookup" },
  },
  tokenCostUsdPerMillion: 5,
};

async function runTool(toolName: string): Promise<{ isError: boolean; content: string }> {
  const result = await executeQaTool(toolName, {}, "test-correlation-id");
  return { isError: result.isError === true, content: result.content as string };
}

beforeEach(() => {
  mockExecute.mockReset();
  mockGetCallerCredentials.mockReset();
  mockGetCallerCredentials.mockResolvedValue({});
});

describe("muggle-remote-pricing-get", () => {
  it("is registered as a tool that needs no sign-in", () => {
    expect(getQaToolByName(PRICING_TOOL_NAME)?.requiresAuth).toBe(false);
  });

  it("reads the public product catalog", async () => {
    mockExecute.mockResolvedValueOnce({ statusCode: 200, data: productCatalog, headers: {} });
    await runTool(PRICING_TOOL_NAME);
    expect(mockExecute).toHaveBeenCalledWith({ method: "GET", path: "/v1/public/product-catalog" }, {}, "test-correlation-id");
  });

  it("returns plans and packages in the catalog's order, without Stripe identifiers", async () => {
    mockExecute.mockResolvedValueOnce({ statusCode: 200, data: productCatalog, headers: {} });
    const result = await runTool(PRICING_TOOL_NAME);

    expect(result.isError).toBe(false);
    expect(result.content.toLowerCase()).not.toContain("stripe");
    expect(result.content).not.toContain("_lookup");
    expect(JSON.parse(result.content)).toEqual({
      catalogVersion: "2026-10",
      plans: [
        {
          planId: "ENTERPRISE",
          name: "Enterprise",
          description: "For teams",
          monthlyPriceUsd: 50,
          isPerSeat: false,
          minimumSeats: null,
          concurrentWorkflows: 20,
          includedTokens: 0,
          tokenGrantCadence: null,
          featureDescriptions: ["From 20 concurrent workflows"],
        },
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
      ],
      tokenPackages: [
        { packageId: "pro_10000", name: "Pro", tokens: 10_000_000, priceUsd: 50 },
        { packageId: "starter_5000", name: "Starter", tokens: 5_000_000, priceUsd: 25 },
      ],
      tokenPriceUsdPerMillion: 5,
    });
  });
});

describe("muggle-remote-wallet-package-list", () => {
  it("is registered as a tool that needs sign-in", () => {
    expect(getQaToolByName(PACKAGE_LIST_TOOL_NAME)?.requiresAuth).not.toBe(false);
  });

  it("lists the caller's packages in currency units, without Stripe identifiers", async () => {
    mockGetCallerCredentials.mockResolvedValue({ bearerToken: "test-token" });
    mockExecute.mockResolvedValueOnce({
      statusCode: 200,
      data: {
        packages: [
          {
            packageId: "starter_5000",
            stripePriceId: "price_123",
            stripePriceLookupKey: "starter_lookup",
            name: "Starter",
            description: "5M tokens",
            tokenAmount: 5_000_000,
            price: 2500,
            currency: "USD",
          },
        ],
        tokenCostUsdPerMillion: 5,
      },
      headers: {},
    });
    const result = await runTool(PACKAGE_LIST_TOOL_NAME);

    expect(mockExecute).toHaveBeenCalledWith(
      { method: "GET", path: "/v1/protected/wallet/packages" },
      { bearerToken: "test-token" },
      "test-correlation-id",
    );
    expect(result.content.toLowerCase()).not.toContain("stripe");
    expect(result.content).not.toContain("price_123");
    expect(JSON.parse(result.content)).toEqual({
      packages: [
        { packageId: "starter_5000", name: "Starter", description: "5M tokens", tokens: 5_000_000, price: 25, currency: "USD" },
      ],
      tokenPriceUsdPerMillion: 5,
    });
  });

  it("is the packageId source muggle-remote-wallet-topup points to", () => {
    expect(getQaToolByName("muggle-remote-wallet-topup")?.description).toContain(PACKAGE_LIST_TOOL_NAME);
  });
});
