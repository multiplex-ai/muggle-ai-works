import { compareVersions } from "./compareVersions.mjs";

/**
 * Decide which integrity evidence a download must produce before it is trusted.
 *
 * Releases cut before signing existed carry only a checksum, so the signature
 * requirement is pinned to the first version that ships one. Below that pin the
 * checksum is mandatory rather than advisory: a download with neither signature
 * nor checksum is refused instead of being installed behind a warning.
 *
 * @param {object} params - Policy inputs.
 * @param {string} params.version - Electron app version being installed.
 * @param {string} params.signedFromVersion - First version published with a signature.
 * @param {string} params.expectedChecksum - Configured SHA256, empty when none.
 * @returns {{requiresSignature: boolean, requiresChecksum: boolean, unverifiableReason: string}} Which checks apply, and why none can.
 */
export function resolveIntegrityPolicy({ version, signedFromVersion, expectedChecksum }) {
    const requiresSignature = Boolean(signedFromVersion) && compareVersions(version, signedFromVersion) >= 0;
    const hasChecksum = Boolean(expectedChecksum && expectedChecksum.trim());

    if (!requiresSignature && !hasChecksum) {
        return {
            requiresSignature: false,
            requiresChecksum: false,
            unverifiableReason:
                `no integrity evidence is available for v${version}: it predates release signing ` +
                `(first signed version: ${signedFromVersion || "none configured"}) ` +
                `and no checksum is configured for this release stream`,
        };
    }

    return {
        requiresSignature: requiresSignature,
        requiresChecksum: !requiresSignature,
        unverifiableReason: "",
    };
}
