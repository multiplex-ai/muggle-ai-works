/* global AbortController */
import { readFile } from "node:fs/promises";
import { verify } from "sigstore";
import { SIGNATURE_FETCH_TIMEOUT_MS, SIGNER_CERTIFICATE_ISSUER } from "./constants.mjs";

/**
 * Verify a downloaded release asset against the Sigstore bundle published beside it.
 *
 * The bundle proves the asset was produced by a specific workflow in the studio
 * source repository, so the signer identity is pinned exactly: a bundle that is
 * otherwise valid but was issued to any other workflow is rejected.
 *
 * @param {object} params - Verification parameters.
 * @param {string} params.artifactPath - Path to the downloaded asset.
 * @param {string} params.bundleUrl - URL of the asset's Sigstore bundle.
 * @param {string} params.signerIdentityUri - Certificate subject the signer must carry.
 * @returns {Promise<{valid: boolean, reason: string}>} Verification outcome, with the rejection cause when invalid.
 */
export async function verifyReleaseSignature({ artifactPath, bundleUrl, signerIdentityUri }) {
    if (!signerIdentityUri) {
        return { valid: false, reason: "no signer identity is configured to verify against" };
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
            };
        }
        bundle = await response.json();
    } catch (error) {
        return { valid: false, reason: `could not fetch signature bundle: ${error.message}` };
    } finally {
        clearTimeout(timer);
    }

    try {
        await verify(bundle, await readFile(artifactPath), {
            certificateIssuer: SIGNER_CERTIFICATE_ISSUER,
            certificateIdentityURI: signerIdentityUri,
        });
        return { valid: true, reason: "" };
    } catch (error) {
        return { valid: false, reason: error.message };
    }
}
