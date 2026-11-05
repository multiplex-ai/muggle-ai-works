/** Suffix appended to a release asset's name to locate its Sigstore bundle. */
export const SIGNATURE_BUNDLE_SUFFIX = ".sigstore.json";

/** OIDC issuer that must have issued the signing certificate. */
export const SIGNER_CERTIFICATE_ISSUER = "https://token.actions.githubusercontent.com";

/** Abort budget for fetching a signature bundle. */
export const SIGNATURE_FETCH_TIMEOUT_MS = 30_000;

/** Host every signature check reads the Sigstore trust root from. */
export const SIGNATURE_TRUST_ROOT_HOST = "tuf-repo-cdn.sigstore.dev";

/** Printed once a download's signature has been proven. */
export const SIGNATURE_VERIFIED_MESSAGE = "Signature verified successfully.";

/** Opens every signature refusal, ahead of the cause. */
export const SIGNATURE_REFUSAL_PREFIX = "Signature verification failed, refusing to install: ";

/** Digest algorithm release bundles record, as the bundle spells it. */
export const BUNDLE_DIGEST_ALGORITHM = "SHA2_256";

/** The same digest algorithm, as node:crypto spells it. */
export const BUNDLE_HASH_ALGORITHM = "sha256";

/** Prefix an X.509 subject alternative name carries when it holds a URI. */
export const CERTIFICATE_URI_SAN_PREFIX = "URI:";

/** Separator between the entries of a certificate's subject alternative name. */
export const CERTIFICATE_SAN_SEPARATOR = ", ";

/** TUF client failures that mean a fetch went wrong, not that a file on disk did. */
export const TRUST_ROOT_FETCH_ERROR_CODES = new Set([
    "TUF_REFRESH_METADATA_ERROR",
    "TUF_DOWNLOAD_TARGET_ERROR",
]);

/** Socket and resolver failures that show no HTTP exchange with the host ever happened. */
export const HOST_UNREACHABLE_ERROR_CODES = new Set([
    "ENOTFOUND",
    "EAI_AGAIN",
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "ENETUNREACH",
    "EHOSTUNREACH",
    "ENETDOWN",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_SOCKET",
]);

/** Name of the error an elapsed abort signal rejects a fetch with. */
export const FETCH_TIMEOUT_ERROR_NAME = "TimeoutError";

/**
 * Whole message of a timeout the TUF client caught mid-refresh and flattened to text,
 * leaving no type to read. `fetch failed` flattens the same way, but is left out on
 * purpose: as text it cannot be told from a TLS failure.
 */
export const FLATTENED_TRUST_ROOT_TIMEOUT_PATTERN =
    /^Unable to load (?:snapshot metadata|targets) error TimeoutError: The operation was aborted due to timeout$/;

/** Links followed through an error's causes; a cycle must not hang an install. */
export const MAX_ERROR_CAUSE_DEPTH = 5;
