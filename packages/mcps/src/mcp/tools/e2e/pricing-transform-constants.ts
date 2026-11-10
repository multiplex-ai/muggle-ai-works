/** MCP tool serving the public pricing catalog; the `muggle pricing` command calls it too. */
export const PRICING_GET_TOOL_NAME = "muggle-remote-pricing-get";

/** Prompt-service route listing the token packages the signed-in caller can buy. */
export const WALLET_PACKAGES_PATH = "/v1/protected/wallet/packages";

/** Stripe amounts are in minor units; every currency the wallet sells in has two decimals. */
export const STRIPE_MINOR_UNITS_PER_MAJOR_UNIT = 100;
