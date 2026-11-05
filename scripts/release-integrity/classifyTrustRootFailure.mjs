import { TUFError } from "sigstore";
import {
    FETCH_TIMEOUT_ERROR_NAME,
    FLATTENED_TRUST_ROOT_TIMEOUT_PATTERN,
    HOST_UNREACHABLE_ERROR_CODES,
    MAX_ERROR_CAUSE_DEPTH,
    TRUST_ROOT_FETCH_ERROR_CODES,
} from "./constants.mjs";

/**
 * List an error and its causes, outermost first.
 *
 * @param {unknown} error - The outermost error.
 * @returns {Array<{name?: string, code?: unknown, message?: string, cause?: unknown}>} The chain, cut off at the depth limit.
 */
function listErrorChain(error) {
    const chain = [];
    let current = error;

    while (current && chain.length < MAX_ERROR_CAUSE_DEPTH) {
        chain.push(current);
        current = current.cause;
    }

    return chain;
}

/**
 * Decide whether a failed trust-root load means the host could not be reached.
 *
 * Only pass an error from loading the trust root: that step never reads the bundle,
 * so nothing a bundle contains can reach this decision. Anything not positively
 * recognised as a network failure is false, which refuses the install. TLS failures,
 * HTTP statuses, invalid TUF metadata and file system errors are all false, because
 * in each the host answered or the failure is local.
 *
 * @param {unknown} trustRootError - What loading the trust root rejected with.
 * @returns {boolean} True only for a recognised network failure reaching the host.
 */
export function isTrustRootUnreachable(trustRootError) {
    if (!(trustRootError instanceof TUFError) || !TRUST_ROOT_FETCH_ERROR_CODES.has(trustRootError.code)) {
        return false;
    }

    return listErrorChain(trustRootError.cause).some(
        (chainedError) =>
            chainedError.name === FETCH_TIMEOUT_ERROR_NAME ||
            HOST_UNREACHABLE_ERROR_CODES.has(chainedError.code) ||
            FLATTENED_TRUST_ROOT_TIMEOUT_PATTERN.test(chainedError.message ?? ""),
    );
}

/**
 * Render an error and its causes as one line, since the outermost TUF message alone
 * never says what went wrong.
 *
 * @param {unknown} error - The outermost error.
 * @returns {string} Every message in the chain, outermost first.
 *
 * Output shape: `"error refreshing TUF metadata: fetch failed: getaddrinfo ENOTFOUND tuf-repo-cdn.sigstore.dev"`
 */
export function describeErrorChain(error) {
    return listErrorChain(error)
        .map((chainedError) => chainedError.message)
        .filter(Boolean)
        .join(": ");
}
