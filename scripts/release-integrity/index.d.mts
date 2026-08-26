export declare const SIGNATURE_BUNDLE_SUFFIX: string;
export declare const SIGNATURE_FETCH_TIMEOUT_MS: number;
export declare const SIGNER_CERTIFICATE_ISSUER: string;

export declare function compareVersions(a: string, b: string): number;

export declare function resolveIntegrityPolicy(params: {
    version: string;
    signedFromVersion: string;
    expectedChecksum: string;
}): {
    requiresSignature: boolean;
    requiresChecksum: boolean;
    unverifiableReason: string;
};

export declare function verifyReleaseSignature(params: {
    artifactPath: string;
    bundleUrl: string;
    signerIdentityUri: string;
}): Promise<{ valid: boolean; reason: string }>;
