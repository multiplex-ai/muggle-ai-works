import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sigstore", () => ({ verify: vi.fn() }));

const { verify } = await import("sigstore");
const { compareVersions } = await import("../../scripts/release-integrity/compareVersions.mjs");
const { resolveIntegrityPolicy } = await import("../../scripts/release-integrity/resolveIntegrityPolicy.mjs");
const { verifyReleaseSignature } = await import("../../scripts/release-integrity/verifyReleaseSignature.mjs");

const SIGNER = "https://github.com/multiplex-ai/muggle-ai-teaching-service/.github/workflows/release-electron-app-reusable.yml@refs/heads/master";

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
        vi.mocked(verify).mockReset();
    });

    it("accepts a bundle that verifies against the pinned signer identity", async () => {
        const bundle = { mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json" };
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => bundle })));
        vi.mocked(verify).mockResolvedValue(undefined);

        const result = await verifyReleaseSignature({
            artifactPath: "package.json",
            bundleUrl: "https://example.invalid/asset.zip.sigstore.json",
            signerIdentityUri: SIGNER,
        });

        expect(result.valid).toBe(true);
        expect(vi.mocked(verify).mock.calls[0][2]).toEqual({
            certificateIssuer: "https://token.actions.githubusercontent.com",
            certificateIdentityURI: SIGNER,
        });
    });

    it("rejects when the signature does not verify", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
        vi.mocked(verify).mockRejectedValue(new Error("signature verification failed"));

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
        expect(vi.mocked(verify)).not.toHaveBeenCalled();
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
});
