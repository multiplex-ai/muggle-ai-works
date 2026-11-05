/* global structuredClone */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sigstore", async (importOriginal) => {
    const actualSigstore = await importOriginal();
    const createVerifier = vi.fn();
    return {
        ...actualSigstore,
        createVerifier: createVerifier,
        verify: async (bundle, data, options) => (await createVerifier(options)).verify(bundle, data),
    };
});

const { PolicyError, VerificationError, createVerifier } = await import("sigstore");
const { compareVersions } = await import("../../scripts/release-integrity/compareVersions.mjs");
const { resolveIntegrityPolicy } = await import("../../scripts/release-integrity/resolveIntegrityPolicy.mjs");
const { verifyReleaseSignature } = await import("../../scripts/release-integrity/verifyReleaseSignature.mjs");
const { enforceReleaseSignature } = await import("../../scripts/release-integrity/enforceReleaseSignature.mjs");
const { findBundleMismatch } = await import("../../scripts/release-integrity/findBundleMismatch.mjs");
const { isTrustRootUnreachable, describeErrorChain } = await import(
    "../../scripts/release-integrity/classifyTrustRootFailure.mjs"
);
const {
    CORE_UNREACHABLE_FAILURES,
    UNCLASSIFIABLE_FAILURES,
    UNREACHABLE_FAILURES,
    codedError,
    fetchFailed,
    metadataRefreshFailure,
} = await import("../fixtures/release-integrity/trust-root-failures.ts");

const SIGNER = "https://github.com/multiplex-ai/muggle-ai-teaching-service/.github/workflows/release-electron-app-reusable.yml@refs/heads/master";
const TRUST_ROOT_HOST = "tuf-repo-cdn.sigstore.dev";
const VERIFIED_MESSAGE = "Signature verified successfully.";

const signedRelease = JSON.parse(
    readFileSync(new URL("../fixtures/release-integrity/signed-release.json", import.meta.url), "utf-8"),
);
const archiveBytes = Buffer.from(signedRelease.archiveBase64, "base64");
const fixtureDir = mkdtempSync(join(tmpdir(), "mgl-release-integrity-"));
const archivePath = join(fixtureDir, "archive.zip");
writeFileSync(archivePath, archiveBytes);

/** Returns a copy of the fixture bundle with one change applied, leaving the original intact. */
function alteredBundle(applyChange) {
    const bundleCopy = structuredClone(signedRelease.bundle);
    applyChange(bundleCopy);
    return bundleCopy;
}

/** Flips the first byte of a base64 value, so it decodes to different bytes of the same length. */
function flipFirstByte(base64Value) {
    const valueBytes = Buffer.from(base64Value, "base64");
    valueBytes[0] ^= 0xff;
    return valueBytes.toString("base64");
}

/** Serves one bundle from the release. */
function serveBundle(bundle) {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => bundle })));
}

/** Verifies the fixture archive against a bundle, with the fixture's signer pinned. */
function verifyFixtureArchive() {
    return verifyReleaseSignature({
        artifactPath: archivePath,
        bundleUrl: "https://example.invalid/asset.zip.sigstore.json",
        signerIdentityUri: signedRelease.signerIdentityUri,
    });
}

describe("compareVersions", () => {
    it("orders by major, minor, then patch", () => {
        expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
        expect(compareVersions("1.9.0", "1.10.0")).toBe(-1);
        expect(compareVersions("1.10.0", "1.10.0")).toBe(0);
    });

    it("treats missing segments as zero", () => {
        expect(compareVersions("2", "2.0.0")).toBe(0);
    });
});

describe("resolveIntegrityPolicy", () => {
    it("requires a signature at the pinned version", () => {
        const policy = resolveIntegrityPolicy({
            version: "1.10.0",
            signedFromVersion: "1.10.0",
            expectedChecksum: "",
        });

        expect(policy.requiresSignature).toBe(true);
        expect(policy.requiresChecksum).toBe(false);
        expect(policy.unverifiableReason).toBe("");
    });

    it("requires a signature above the pinned version even when a checksum exists", () => {
        const policy = resolveIntegrityPolicy({
            version: "2.0.0",
            signedFromVersion: "1.10.0",
            expectedChecksum: "a".repeat(64),
        });

        expect(policy.requiresSignature).toBe(true);
    });

    it("falls back to a mandatory checksum below the pinned version", () => {
        const policy = resolveIntegrityPolicy({
            version: "1.9.0",
            signedFromVersion: "1.10.0",
            expectedChecksum: "a".repeat(64),
        });

        expect(policy.requiresSignature).toBe(false);
        expect(policy.requiresChecksum).toBe(true);
        expect(policy.unverifiableReason).toBe("");
    });

    it("refuses a pre-pin version that has no checksum instead of skipping verification", () => {
        const policy = resolveIntegrityPolicy({
            version: "1.9.0",
            signedFromVersion: "1.10.0",
            expectedChecksum: "",
        });

        expect(policy.requiresSignature).toBe(false);
        expect(policy.requiresChecksum).toBe(false);
        expect(policy.unverifiableReason).toContain("no integrity evidence");
    });

    it("refuses a whitespace-only checksum", () => {
        const policy = resolveIntegrityPolicy({
            version: "1.9.0",
            signedFromVersion: "1.10.0",
            expectedChecksum: "   ",
        });

        expect(policy.unverifiableReason).toContain("no integrity evidence");
    });

    it("refuses everything when no signed-from version is configured and no checksum exists", () => {
        const policy = resolveIntegrityPolicy({
            version: "9.9.9",
            signedFromVersion: "",
            expectedChecksum: "",
        });

        expect(policy.requiresSignature).toBe(false);
        expect(policy.unverifiableReason).toContain("none configured");
    });
});

describe("verifyReleaseSignature", () => {
    beforeEach(() => {
        vi.mocked(createVerifier).mockReset();
    });

    it("accepts a bundle that verifies against the pinned signer identity", async () => {
        const bundle = { mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json" };
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => bundle })));
        vi.mocked(createVerifier).mockResolvedValue({ verify: vi.fn() });

        const result = await verifyReleaseSignature({
            artifactPath: "package.json",
            bundleUrl: "https://example.invalid/asset.zip.sigstore.json",
            signerIdentityUri: SIGNER,
        });

        expect(result.valid).toBe(true);
        expect(vi.mocked(createVerifier).mock.calls[0][0]).toEqual({
            certificateIssuer: "https://token.actions.githubusercontent.com",
            certificateIdentityURI: SIGNER,
        });
    });

    it("rejects when the signature does not verify", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
        vi.mocked(createVerifier).mockResolvedValue({
            verify: vi.fn(() => {
                throw new Error("signature verification failed");
            }),
        });

        const result = await verifyReleaseSignature({
            artifactPath: "package.json",
            bundleUrl: "https://example.invalid/asset.zip.sigstore.json",
            signerIdentityUri: SIGNER,
        });

        expect(result.valid).toBe(false);
        expect(result.reason).toContain("signature verification failed");
    });

    it("rejects when the bundle is missing from the release", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));

        const result = await verifyReleaseSignature({
            artifactPath: "package.json",
            bundleUrl: "https://example.invalid/asset.zip.sigstore.json",
            signerIdentityUri: SIGNER,
        });

        expect(result.valid).toBe(false);
        expect(result.reason).toContain("404");
        expect(vi.mocked(createVerifier)).not.toHaveBeenCalled();
    });

    it("rejects when the bundle cannot be fetched at all", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => {
            throw new Error("network down");
        }));

        const result = await verifyReleaseSignature({
            artifactPath: "package.json",
            bundleUrl: "https://example.invalid/asset.zip.sigstore.json",
            signerIdentityUri: SIGNER,
        });

        expect(result.valid).toBe(false);
        expect(result.reason).toContain("network down");
    });

    it("rejects when no signer identity is configured rather than trusting any signature", async () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal("fetch", fetchSpy);

        const result = await verifyReleaseSignature({
            artifactPath: "package.json",
            bundleUrl: "https://example.invalid/asset.zip.sigstore.json",
            signerIdentityUri: "",
        });

        expect(result.valid).toBe(false);
        expect(result.reason).toContain("no signer identity");
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it.each(UNREACHABLE_FAILURES)("reports %s as an unreachable trust root", async (_label, buildFailure) => {
        serveBundle(signedRelease.bundle);
        vi.mocked(createVerifier).mockRejectedValue(buildFailure());

        const outcome = await verifyFixtureArchive();

        expect(outcome.valid).toBe(false);
        expect(outcome.isTrustRootUnreachable).toBe(true);
    });

    it.each(UNCLASSIFIABLE_FAILURES)("refuses %s without calling it a network failure", async (_label, buildFailure) => {
        serveBundle(signedRelease.bundle);
        vi.mocked(createVerifier).mockRejectedValue(buildFailure());

        const outcome = await verifyFixtureArchive();

        expect(outcome.valid).toBe(false);
        expect(outcome.isTrustRootUnreachable).toBe(false);
        expect(outcome.reason).toContain(TRUST_ROOT_HOST);
    });

    it.each([
        ["a verification error", () => new VerificationError({ code: "TLOG_INCLUSION_PROOF_ERROR", message: "bad proof" })],
        ["a wrong signer", () => new PolicyError({ code: "UNTRUSTED_SIGNER_ERROR", message: "identity mismatch" })],
        ["an error worded like a DNS failure", () => new Error("fetch failed: getaddrinfo ENOTFOUND"), ],
        ["an error typed like a network failure", () => CORE_UNREACHABLE_FAILURES[0][1]()],
        ["an error typed like a timeout", () => CORE_UNREACHABLE_FAILURES[2][1]()],
    ])("never treats %s from checking the bundle as unreachable", async (_label, buildFailure) => {
        serveBundle(signedRelease.bundle);
        vi.mocked(createVerifier).mockResolvedValue({
            verify: vi.fn(() => {
                throw buildFailure();
            }),
        });

        const outcome = await verifyFixtureArchive();

        expect(outcome.valid).toBe(false);
        expect(outcome.isTrustRootUnreachable).toBe(false);
    });

    it("hands the bundle to no one until the trust root has loaded", async () => {
        serveBundle(signedRelease.bundle);
        vi.mocked(createVerifier).mockResolvedValue({ verify: vi.fn() });

        await verifyFixtureArchive();

        expect(vi.mocked(createVerifier).mock.calls[0]).toHaveLength(1);
        expect(JSON.stringify(vi.mocked(createVerifier).mock.calls[0])).not.toContain("messageSignature");
    });

    it.each([
        ["a digest for other bytes", (bundle) => {
            bundle.messageSignature.messageDigest.digest = flipFirstByte(bundle.messageSignature.messageDigest.digest);
        }],
        ["a corrupted signature", (bundle) => {
            bundle.messageSignature.signature = flipFirstByte(bundle.messageSignature.signature);
        }],
        ["a corrupted certificate", (bundle) => {
            bundle.verificationMaterial.certificate.rawBytes = flipFirstByte(bundle.verificationMaterial.certificate.rawBytes);
        }],
        ["no message signature", (bundle) => {
            delete bundle.messageSignature;
        }],
    ])("refuses a bundle with %s even when the host is out of reach", async (_label, applyChange) => {
        serveBundle(alteredBundle(applyChange));
        vi.mocked(createVerifier).mockRejectedValue(CORE_UNREACHABLE_FAILURES[0][1]());

        const outcome = await verifyFixtureArchive();

        expect(outcome.valid).toBe(false);
        expect(outcome.isTrustRootUnreachable).toBe(false);
    });

    it("refuses another signer's bundle even when the host is out of reach", async () => {
        serveBundle(signedRelease.wrongIdentityBundle);
        vi.mocked(createVerifier).mockRejectedValue(CORE_UNREACHABLE_FAILURES[0][1]());

        const outcome = await verifyFixtureArchive();

        expect(outcome.isTrustRootUnreachable).toBe(false);
        expect(outcome.reason).toContain("not issued to");
    });

    it("refuses a missing bundle without ever asking for the trust root", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 })));
        vi.mocked(createVerifier).mockRejectedValue(CORE_UNREACHABLE_FAILURES[0][1]());

        const outcome = await verifyFixtureArchive();

        expect(outcome.isTrustRootUnreachable).toBe(false);
        expect(vi.mocked(createVerifier)).not.toHaveBeenCalled();
    });
});

describe("isTrustRootUnreachable", () => {
    it.each(UNREACHABLE_FAILURES)("recognises %s", (_label, buildFailure) => {
        expect(isTrustRootUnreachable(buildFailure())).toBe(true);
    });

    it.each(UNCLASSIFIABLE_FAILURES)("does not recognise %s", (_label, buildFailure) => {
        expect(isTrustRootUnreachable(buildFailure())).toBe(false);
    });

    it("stops following a cause chain that loops", () => {
        const loopingCause = new Error("loops");
        loopingCause.cause = loopingCause;

        expect(isTrustRootUnreachable(metadataRefreshFailure(loopingCause))).toBe(false);
    });

    it("spells out the whole cause chain", () => {
        const failure = metadataRefreshFailure(fetchFailed(codedError("ENOTFOUND", "getaddrinfo ENOTFOUND host")));

        expect(describeErrorChain(failure)).toBe("error refreshing TUF metadata: fetch failed: getaddrinfo ENOTFOUND host");
    });
});

describe("findBundleMismatch", () => {
    it("finds nothing wrong with the bundle made for this download", () => {
        expect(
            findBundleMismatch({
                bundle: signedRelease.bundle,
                artifactBytes: archiveBytes,
                signerIdentityUri: signedRelease.signerIdentityUri,
            }),
        ).toBe("");
    });

    it("rejects a download that differs from what the bundle records", () => {
        expect(
            findBundleMismatch({
                bundle: signedRelease.bundle,
                artifactBytes: Buffer.concat([archiveBytes, Buffer.from("x")]),
                signerIdentityUri: signedRelease.signerIdentityUri,
            }),
        ).toContain("does not match the digest");
    });

    it("rejects a digest algorithm releases do not use", () => {
        const bundle = alteredBundle((bundleCopy) => {
            bundleCopy.messageSignature.messageDigest.algorithm = "SHA2_512";
        });

        expect(
            findBundleMismatch({
                bundle: bundle,
                artifactBytes: archiveBytes,
                signerIdentityUri: signedRelease.signerIdentityUri,
            }),
        ).toContain("SHA2_512");
    });

    it("rejects a bundle that is not one at all", () => {
        expect(
            findBundleMismatch({
                bundle: null,
                artifactBytes: archiveBytes,
                signerIdentityUri: signedRelease.signerIdentityUri,
            }),
        ).toContain("missing");
    });

    it("rejects an unreadable signature", () => {
        const bundle = alteredBundle((bundleCopy) => {
            bundleCopy.messageSignature.signature = "AAAA";
        });

        expect(
            findBundleMismatch({
                bundle: bundle,
                artifactBytes: archiveBytes,
                signerIdentityUri: signedRelease.signerIdentityUri,
            }),
        ).not.toBe("");
    });
});

describe("enforceReleaseSignature", () => {
    const logInfo = vi.fn();
    const logWarning = vi.fn();

    /** Holds the fixture archive to its signature with a checksum to fall back on. */
    function enforceOnFixtureArchive(expectedChecksum) {
        return enforceReleaseSignature({
            artifactPath: archivePath,
            bundleUrl: "https://example.invalid/asset.zip.sigstore.json",
            signerIdentityUri: signedRelease.signerIdentityUri,
            expectedChecksum: expectedChecksum,
            logInfo: logInfo,
            logWarning: logWarning,
        });
    }

    beforeEach(() => {
        vi.mocked(createVerifier).mockReset();
        logInfo.mockReset();
        logWarning.mockReset();
        serveBundle(signedRelease.bundle);
    });

    it("reports a proven signature and warns about nothing", async () => {
        vi.mocked(createVerifier).mockResolvedValue({ verify: vi.fn() });

        const enforcement = await enforceOnFixtureArchive(signedRelease.archiveSha256);

        expect(enforcement.isSignatureVerified).toBe(true);
        expect(logInfo).toHaveBeenCalledWith(VERIFIED_MESSAGE);
        expect(logWarning).not.toHaveBeenCalled();
    });

    it.each(CORE_UNREACHABLE_FAILURES)("warns and leaves the checksum to decide on %s", async (_label, buildFailure) => {
        vi.mocked(createVerifier).mockRejectedValue(buildFailure());

        const enforcement = await enforceOnFixtureArchive(signedRelease.archiveSha256);

        expect(enforcement.isSignatureVerified).toBe(false);
        expect(logInfo).not.toHaveBeenCalledWith(VERIFIED_MESSAGE);
        const warning = logWarning.mock.calls[0][0];
        expect(warning).toContain("NOT verified");
        expect(warning).toContain("network failure");
        expect(warning).toContain(TRUST_ROOT_HOST);
        expect(warning).toContain("checksum");
    });

    it("names the underlying network cause in the warning", async () => {
        vi.mocked(createVerifier).mockRejectedValue(CORE_UNREACHABLE_FAILURES[1][1]());

        await enforceOnFixtureArchive(signedRelease.archiveSha256);

        expect(logWarning.mock.calls[0][0]).toContain("ECONNREFUSED");
    });

    it.each([
        ["empty", ""],
        ["blank", "   "],
    ])("refuses when the host is out of reach and the checksum is %s", async (_label, expectedChecksum) => {
        vi.mocked(createVerifier).mockRejectedValue(CORE_UNREACHABLE_FAILURES[0][1]());

        await expect(enforceOnFixtureArchive(expectedChecksum)).rejects.toThrow("no checksum is available");
        expect(logWarning).not.toHaveBeenCalled();
        expect(logInfo).not.toHaveBeenCalled();
    });

    it.each(UNCLASSIFIABLE_FAILURES)("refuses %s", async (_label, buildFailure) => {
        vi.mocked(createVerifier).mockRejectedValue(buildFailure());

        await expect(enforceOnFixtureArchive(signedRelease.archiveSha256)).rejects.toThrow("refusing to install");
        expect(logWarning).not.toHaveBeenCalled();
    });

    it("refuses a bad signature whatever checksum is on offer", async () => {
        vi.mocked(createVerifier).mockResolvedValue({
            verify: vi.fn(() => {
                throw new VerificationError({ code: "TLOG_INCLUSION_PROOF_ERROR", message: "bad proof" });
            }),
        });

        await expect(enforceOnFixtureArchive(signedRelease.archiveSha256)).rejects.toThrow("refusing to install: bad proof");
    });
});
