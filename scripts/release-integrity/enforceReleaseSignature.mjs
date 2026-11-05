import {
    SIGNATURE_REFUSAL_PREFIX,
    SIGNATURE_TRUST_ROOT_HOST,
    SIGNATURE_VERIFIED_MESSAGE,
} from "./constants.mjs";
import { hasExpectedChecksum } from "./resolveIntegrityPolicy.mjs";
import { verifyReleaseSignature } from "./verifyReleaseSignature.mjs";

/**
 * Hold a download to its signature, the same way on every install path.
 *
 * A signature that fails refuses. The one exception is a trust root the network kept
 * out of reach: then nothing was proven either way, so the caller warns and the
 * checksum decides. That needs a checksum to exist, so with none the download refuses.
 * Callers must treat a checksum mismatch as fatal whenever `isSignatureVerified` is false.
 *
 * @param {object} params - Enforcement inputs.
 * @param {string} params.artifactPath - Path to the downloaded asset.
 * @param {string} params.bundleUrl - URL of the asset's Sigstore bundle.
 * @param {string} params.signerIdentityUri - Certificate subject the signer must carry.
 * @param {string} params.expectedChecksum - SHA256 the fallback would check, empty when none.
 * @param {(message: string) => void} params.logInfo - Writes a progress line.
 * @param {(message: string) => void} params.logWarning - Writes a warning.
 * @returns {Promise<{isSignatureVerified: boolean}>} Whether the signature was proven.
 * @throws {Error} When the download must not be installed.
 */
export async function enforceReleaseSignature({
    artifactPath,
    bundleUrl,
    signerIdentityUri,
    expectedChecksum,
    logInfo,
    logWarning,
}) {
    const signatureOutcome = await verifyReleaseSignature({
        artifactPath: artifactPath,
        bundleUrl: bundleUrl,
        signerIdentityUri: signerIdentityUri,
    });

    if (signatureOutcome.valid) {
        logInfo(SIGNATURE_VERIFIED_MESSAGE);
        return { isSignatureVerified: true };
    }

    if (!signatureOutcome.isTrustRootUnreachable) {
        throw new Error(SIGNATURE_REFUSAL_PREFIX + signatureOutcome.reason);
    }

    const networkFailure =
        `a network failure kept ${SIGNATURE_TRUST_ROOT_HOST} out of reach (${signatureOutcome.reason})`;

    if (!hasExpectedChecksum(expectedChecksum)) {
        throw new Error(`${SIGNATURE_REFUSAL_PREFIX}${networkFailure}, and no checksum is available to check instead.`);
    }

    logWarning(
        `WARNING: The signature was NOT verified: ${networkFailure}. ` +
            `Falling back to the checksum check only.`,
    );
    return { isSignatureVerified: false };
}
