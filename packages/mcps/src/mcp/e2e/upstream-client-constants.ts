/** Unauthenticated prompt-service route serving plans, token price and token packages. */
export const PRODUCT_CATALOG_PATH = "/v1/public/product-catalog";

/** Exact prompt-service paths that answer without credentials, so a signed-out caller may reach them. */
export const PUBLIC_UPSTREAM_PATHS = [PRODUCT_CATALOG_PATH];
