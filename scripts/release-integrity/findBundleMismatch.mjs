import { X509Certificate, createHash, verify as verifyMessageSignature } from "node:crypto";
import {
    BUNDLE_DIGEST_ALGORITHM,
    BUNDLE_HASH_ALGORITHM,
    CERTIFICATE_SAN_SEPARATOR,
    CERTIFICATE_URI_SAN_PREFIX,
} from "./constants.mjs";

/**
 * Check a bundle against a download without the trust root.
 *
 * This proves nothing about who signed: with no trust root the certificate chain
 * cannot be checked. It only catches a bundle that shows on its own that it is not
 * what was signed, so a blocked host cannot wave those through to the checksum.
 *
 * @param {object} params - Check inputs.
 * @param {object} params.bundle - Parsed Sigstore bundle.
 * @param {Buffer} params.artifactBytes - The downloaded asset.
 * @param {string} params.signerIdentityUri - Certificate subject the signer must carry.
 * @returns {string} Why the bundle cannot be for this download, empty when nothing shows that.
 */
export function findBundleMismatch({ bundle, artifactBytes, signerIdentityUri }) {
    const messageSignature = bundle?.messageSignature;
    const messageDigest = messageSignature?.messageDigest;
    const certificateRawBytes = bundle?.verificationMaterial?.certificate?.rawBytes;

    if (!messageDigest?.digest || !messageSignature?.signature || !certificateRawBytes) {
        return "the signature bundle is missing its digest, signature or signing certificate";
    }

    if (messageDigest.algorithm !== BUNDLE_DIGEST_ALGORITHM) {
        return `the signature bundle uses an unexpected digest algorithm: ${messageDigest.algorithm}`;
    }

    const artifactDigest = createHash(BUNDLE_HASH_ALGORITHM).update(artifactBytes).digest();
    if (!artifactDigest.equals(Buffer.from(messageDigest.digest, "base64"))) {
        return "the download does not match the digest recorded in its signature bundle";
    }

    try {
        const signingCertificate = new X509Certificate(Buffer.from(certificateRawBytes, "base64"));
        const certificateNames = (signingCertificate.subjectAltName ?? "").split(CERTIFICATE_SAN_SEPARATOR);

        if (!certificateNames.includes(`${CERTIFICATE_URI_SAN_PREFIX}${signerIdentityUri}`)) {
            return `the signing certificate was not issued to ${signerIdentityUri}`;
        }

        const isSignatureMatching = verifyMessageSignature(
            BUNDLE_HASH_ALGORITHM,
            artifactBytes,
            signingCertificate.publicKey,
            Buffer.from(messageSignature.signature, "base64"),
        );
        return isSignatureMatching ? "" : "the signature in the bundle does not match the download";
    } catch (error) {
        return `the signature bundle could not be read: ${error.message}`;
    }
}
