/** One plan's price terms in `GET /v1/public/product-catalog`. */
export interface IRawCatalogTierPricing {
  monthly: number;
  perSeat: boolean;
  minimumSeats?: number;
  stripePriceLookupKey?: string;
}

/** One plan's usage limits in `GET /v1/public/product-catalog`. */
export interface IRawCatalogTierQuota {
  concurrentWorkflows: number;
  monthlyTokens: number;
  tokenGrantCadence?: string;
  seats?: number;
}

/** One plan in `GET /v1/public/product-catalog`. */
export interface IRawCatalogTier {
  id: string;
  name: string;
  description?: string;
  pricing: IRawCatalogTierPricing;
  quota: IRawCatalogTierQuota;
  featureDescriptions?: string[];
}

/** One token package in `GET /v1/public/product-catalog`. */
export interface IRawCatalogTokenPackage {
  id: string;
  displayName: string;
  tokens: number;
  priceUsd: number;
  stripePriceLookupKey?: string;
}

/** Body of `GET /v1/public/product-catalog`. */
export interface IRawProductCatalog {
  version?: string;
  tiers?: Record<string, IRawCatalogTier>;
  tokenPackages?: Record<string, IRawCatalogTokenPackage>;
  tokenCostUsdPerMillion?: number;
}

/** One plan, as muggle-remote-pricing-get returns it. */
export interface IPricingPlan {
  planId: string;
  name: string;
  description: string;
  monthlyPriceUsd: number;
  isPerSeat: boolean;
  minimumSeats: number | null;
  concurrentWorkflows: number;
  includedTokens: number;
  tokenGrantCadence: string | null;
  featureDescriptions: string[];
}

/** One purchasable token package, as muggle-remote-pricing-get returns it. */
export interface IPricingTokenPackage {
  packageId: string;
  name: string;
  tokens: number;
  priceUsd: number;
}

/** Output of muggle-remote-pricing-get. */
export interface IPricingCatalogOutput {
  catalogVersion: string | null;
  plans: IPricingPlan[];
  tokenPackages: IPricingTokenPackage[];
  tokenPriceUsdPerMillion: number | null;
}

/** One package in `GET /v1/protected/wallet/packages`; `price` is Stripe's amount in minor units. */
export interface IRawWalletTokenPackage {
  packageId: string;
  stripePriceId?: string;
  stripePriceLookupKey?: string;
  name: string;
  description?: string;
  tokenAmount: number;
  price?: number;
  currency?: string;
}

/** Body of `GET /v1/protected/wallet/packages`. */
export interface IRawWalletPackagesEnvelope {
  packages?: IRawWalletTokenPackage[];
  tokenCostUsdPerMillion?: number;
}

/** One package the caller can buy, as muggle-remote-wallet-package-list returns it. */
export interface IWalletPackageRow {
  packageId: string;
  name: string;
  description: string;
  tokens: number;
  price: number | null;
  currency: string | null;
}

/** Output of muggle-remote-wallet-package-list. */
export interface IWalletPackageListOutput {
  packages: IWalletPackageRow[];
  tokenPriceUsdPerMillion: number | null;
}
