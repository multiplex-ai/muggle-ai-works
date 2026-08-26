/** Suffix appended to a release asset's name to locate its Sigstore bundle. */
export const SIGNATURE_BUNDLE_SUFFIX = ".sigstore.json";

/** OIDC issuer that must have issued the signing certificate. */
export const SIGNER_CERTIFICATE_ISSUER = "https://token.actions.githubusercontent.com";

/** Abort budget for fetching a signature bundle. */
export const SIGNATURE_FETCH_TIMEOUT_MS = 30_000;
