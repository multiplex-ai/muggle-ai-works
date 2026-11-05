/* global AbortController */
import { readFile } from "node:fs/promises";
import { createVerifier } from "sigstore";
import { describeErrorChain, isTrustRootUnreachable } from "./classifyTrustRootFailure.mjs";
import {
    SIGNATURE_FETCH_TIMEOUT_MS,
    SIGNATURE_TRUST_ROOT_HOST,
    SIGNER_CERTIFICATE_ISSUER,
} from "./constants.mjs";
import { findBundleMismatch } from "./findBundleMismatch.mjs";

/**
 * Verify a downloaded release asset against the Sigstore bundle published beside it.
 *
 * The bundle proves the asset was produced by a specific workflow in the studio
 * source repository, so the signer identity is pinned exactly: a bundle that is
 * otherwise valid but was issued to any other workflow is rejected.
 *
 * Loading the trust root and checking the bundle run as separate steps. Only the
 * first can report the host unreachable, and it never sees the bundle, so a tampered
 * bundle cannot be mistaken for a network failure.
 *
 * @param {object} params - Verification parameters.
 * @param {string} params.artifactPath - Path to the downloaded asset.
 * @param {string} params.bundleUrl - URL of the asset's Sigstore bundle.
 * @param {string} params.signerIdentityUri - Certificate subject the signer must carry.
 * @returns {Promise<{valid: boolean, reason: string, isTrustRootUnreachable: boolean}>} Verification outcome. `valid` is false whenever the signature was not proven; `isTrustRootUnreachable` marks the one case where it could not be checked at all.
 */
export async function verifyReleaseSignature({ artifactPath, bundleUrl, signerIdentityUri }) {
    if (!signerIdentityUri) {
        return {
            valid: false,
            reason: "no signer identity is configured to verify against",
            isTrustRootUnreachable: false,
        };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SIGNATURE_FETCH_TIMEOUT_MS);
    let bundle;
    try {
        const response = await fetch(bundleUrl, { signal: controller.signal });
        if (!response.ok) {
            return {
                valid: false,
                reason: `signature bundle unavailable (HTTP ${response.status}) at ${bundleUrl}`,
                isTrustRootUnreachable: false,
            };
        }
        bundle = await response.json();
    } catch (error) {
        return {
            valid: false,
            reason: `could not fetch signature bundle: ${error.message}`,
            isTrustRootUnreachable: false,
        };
    } finally {
        clearTimeout(timer);
    }

    let artifactBytes;
    try {
        artifactBytes = await readFile(artifactPath);
    } catch (error) {
        return { valid: false, reason: error.message, isTrustRootUnreachable: false };
    }

    let bundleVerifier;
    try {
        bundleVerifier = await createVerifier({
            certificateIssuer: SIGNER_CERTIFICATE_ISSUER,
            certificateIdentityURI: signerIdentityUri,
        });
    } catch (error) {
        const failureDescription = describeErrorChain(error);

        if (!isTrustRootUnreachable(error)) {
            return {
                valid: false,
                reason: `could not load the trust root from ${SIGNATURE_TRUST_ROOT_HOST}: ${failureDescription}`,
                isTrustRootUnreachable: false,
            };
        }

        const bundleMismatch = findBundleMismatch({
            bundle: bundle,
            artifactBytes: artifactBytes,
            signerIdentityUri: signerIdentityUri,
        });
        return {
            valid: false,
            reason: bundleMismatch || failureDescription,
            isTrustRootUnreachable: !bundleMismatch,
        };
    }

    try {
        bundleVerifier.verify(bundle, artifactBytes);
        return { valid: true, reason: "", isTrustRootUnreachable: false };
    } catch (error) {
        return { valid: false, reason: error.message, isTrustRootUnreachable: false };
    }
}
