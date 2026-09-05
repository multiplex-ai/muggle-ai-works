import { describe, expect, it } from "vitest";

const {
    PLATFORM_KEY_BY_ASSET_FILE_NAME,
    assertPinnedChecksumsMatchPublished,
    findPublishedChecksum,
    hasValidChecksumEntry,
} = await import("../../scripts/verify-electron-release-checksums.mjs");

const WIN32_PUBLISHED = "d029700622445ab2dab931b2cd206922cf20cf16137ccc7f164ef5c195b45ac5";
const WIN32_STALE = "a8b5b46b97ed788030be84982a3e8d463abbfa7f3e8bc795692ccbffc82bfa92";
const DARWIN_ARM64_PUBLISHED = "0769b8b146b393fbf582b995a1bf7d2e1b9a8ee8fbc08a2108ad9be283291d37";
const DARWIN_X64_PUBLISHED = "db29f8fbddd4e1f1f3098aca33e3ecf6ea1a0647de6d17a0ac809a09524e7464";
const LINUX_PUBLISHED = "5bdf0e98f3eb95c6cd9461cbddefa19e5361354f3faefaba7bead9ea4feabca7";

const publishedChecksumsContent = [
    `${DARWIN_ARM64_PUBLISHED}  MuggleAI-darwin-arm64.zip`,
    `${LINUX_PUBLISHED}  MuggleAI-linux-x64.zip`,
    `${WIN32_PUBLISHED}  MuggleAI-win32-x64.zip`,
    `${DARWIN_X64_PUBLISHED}  MuggleAI-darwin-x64.zip`,
].join("\n");

const freshPins = {
    "darwin-arm64": DARWIN_ARM64_PUBLISHED,
    "darwin-x64": DARWIN_X64_PUBLISHED,
    "linux-x64": LINUX_PUBLISHED,
    "win32-x64": WIN32_PUBLISHED,
};

const assertPins = (pinnedChecksums) =>
    assertPinnedChecksumsMatchPublished({
        pinnedChecksums: pinnedChecksums,
        checksumsContent: publishedChecksumsContent,
        releaseStream: "staging",
        releaseTag: "electron-app-staging-v1.10.3",
    });

describe("findPublishedChecksum", () => {
    it("reads the checksum for an asset", () => {
        expect(
            findPublishedChecksum({
                checksumsContent: publishedChecksumsContent,
                assetFileName: "MuggleAI-win32-x64.zip",
            }),
        ).toBe(WIN32_PUBLISHED);
    });

    it("returns null for an absent asset", () => {
        expect(
            findPublishedChecksum({
                checksumsContent: publishedChecksumsContent,
                assetFileName: "MuggleAI-solaris-sparc.zip",
            }),
        ).toBeNull();
    });

    it("ignores an entry whose checksum is not a sha256", () => {
        expect(
            findPublishedChecksum({
                checksumsContent: "notahash  MuggleAI-win32-x64.zip",
                assetFileName: "MuggleAI-win32-x64.zip",
            }),
        ).toBeNull();
    });
});

describe("hasValidChecksumEntry", () => {
    it("still reports presence for every required asset", () => {
        for (const assetFileName of Object.keys(PLATFORM_KEY_BY_ASSET_FILE_NAME)) {
            expect(
                hasValidChecksumEntry({
                    checksumsContent: publishedChecksumsContent,
                    assetFileName: assetFileName,
                }),
            ).toBe(true);
        }
    });
});

describe("assertPinnedChecksumsMatchPublished", () => {
    it("accepts pins that match the published release", () => {
        expect(() => assertPins(freshPins)).not.toThrow();
    });

    it("rejects a pin left behind by an earlier electron-app version", () => {
        // The exact regression: a 1.9.0-era staging pin against a 1.10.3 artifact. It is
        // well-formed hex, so presence checks alone let it ship.
        expect(() => assertPins({ ...freshPins, "win32-x64": WIN32_STALE })).toThrow(
            /Pinned checksum is stale for staging\/win32-x64/,
        );
    });

    it("names both hashes and the release tag so the fix is obvious", () => {
        let thrownMessage = "";
        try {
            assertPins({ ...freshPins, "win32-x64": WIN32_STALE });
        } catch (error) {
            thrownMessage = error.message;
        }

        expect(thrownMessage).toContain(WIN32_STALE);
        expect(thrownMessage).toContain(WIN32_PUBLISHED);
        expect(thrownMessage).toContain("electron-app-staging-v1.10.3");
        expect(thrownMessage).toContain("checksumsByStream.staging.win32-x64");
    });

    it("rejects a pin for an asset the release never published", () => {
        expect(() =>
            assertPinnedChecksumsMatchPublished({
                pinnedChecksums: freshPins,
                checksumsContent: `${WIN32_PUBLISHED}  MuggleAI-win32-x64.zip`,
                releaseStream: "production",
                releaseTag: "electron-app-v1.10.3",
            }),
        ).toThrow(/absent/);
    });

    it("compares case-insensitively", () => {
        expect(() => assertPins({ ...freshPins, "win32-x64": WIN32_PUBLISHED.toUpperCase() })).not.toThrow();
    });

    it("skips a platform the stream does not pin", () => {
        const { "win32-x64": _omitted, ...withoutWin32 } = freshPins;
        expect(() => assertPins(withoutWin32)).not.toThrow();
    });
});
