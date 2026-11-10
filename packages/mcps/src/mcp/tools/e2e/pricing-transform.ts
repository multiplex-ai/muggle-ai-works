/**
 * Shapes the product catalog and wallet package list for agents: prices in currency units, in the
 * order the backend lists them, with every Stripe identifier left out.
 */

import type { IUpstreamResponse } from "../../e2e/types.js";
import { STRIPE_MINOR_UNITS_PER_MAJOR_UNIT } from "./pricing-transform-constants.js";
import type {
  IPricingCatalogOutput,
  IRawProductCatalog,
  IRawWalletPackagesEnvelope,
  IWalletPackageListOutput,
} from "./pricing-transform-types.js";

/**
 * Maps the public product catalog to plans and token packages.
 *
 * Output shape: `{ catalogVersion: "2026-10", plans: [{ planId: "STARTER", name: "Starter", monthlyPriceUsd: 29, isPerSeat: false, … }], tokenPackages: [{ packageId: "starter_5000", name: "Starter", tokens: 5000000, priceUsd: 25 }], tokenPriceUsdPerMillion: 5 }`
 */
export function mapPricingCatalog(response: IUpstreamResponse): IPricingCatalogOutput {
  const catalog = (response.data ?? {}) as IRawProductCatalog;
  // Plan order is the backend's: price alone would rank a usage-priced Enterprise below Professional.
  const plans = Object.values(catalog.tiers ?? {}).map((tier) => ({
    planId: tier.id,
    name: tier.name,
    description: tier.description ?? "",
    monthlyPriceUsd: tier.pricing.monthly,
    isPerSeat: tier.pricing.perSeat,
    minimumSeats: tier.pricing.minimumSeats ?? null,
    concurrentWorkflows: tier.quota.concurrentWorkflows,
    includedTokens: tier.quota.monthlyTokens,
    tokenGrantCadence: tier.quota.tokenGrantCadence ?? null,
    featureDescriptions: tier.featureDescriptions ?? [],
  }));
  const tokenPackages = Object.values(catalog.tokenPackages ?? {}).map((tokenPackage) => ({
    packageId: tokenPackage.id,
    name: tokenPackage.displayName,
    tokens: tokenPackage.tokens,
    priceUsd: tokenPackage.priceUsd,
  }));
  return {
    catalogVersion: catalog.version ?? null,
    plans: plans,
    tokenPackages: tokenPackages,
    tokenPriceUsdPerMillion: catalog.tokenCostUsdPerMillion ?? null,
  };
}

/**
 * Maps the caller's purchasable token packages, converting Stripe minor units to currency units.
 *
 * Output shape: `{ packages: [{ packageId: "starter_5000", name: "Starter", description: "…", tokens: 5000000, price: 25, currency: "USD" }], tokenPriceUsdPerMillion: 5 }`
 */
export function mapWalletPackageList(response: IUpstreamResponse): IWalletPackageListOutput {
  const envelope = (response.data ?? {}) as IRawWalletPackagesEnvelope;
  return {
    packages: (envelope.packages ?? []).map((tokenPackage) => ({
      packageId: tokenPackage.packageId,
      name: tokenPackage.name,
      description: tokenPackage.description ?? "",
      tokens: tokenPackage.tokenAmount,
      price: tokenPackage.price === undefined ? null : tokenPackage.price / STRIPE_MINOR_UNITS_PER_MAJOR_UNIT,
      currency: tokenPackage.currency ?? null,
    })),
    tokenPriceUsdPerMillion: envelope.tokenCostUsdPerMillion ?? null,
  };
}
