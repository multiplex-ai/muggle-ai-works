/* global structuredClone */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

const sigstoreMocks = vi.hoisted(() => ({ createVerifier: vi.fn() }));
const installPaths = vi.hoisted(() => ({ dataDir: "", homeDir: "" }));
const releaseState = vi.hoisted(() => ({ checksum: "" }));

vi.mock("sigstore", async (importOriginal) => {
  const actualSigstore = await importOriginal<typeof import("sigstore")>();
  return {
    ...actualSigstore,
    createVerifier: sigstoreMocks.createVerifier,
    verify: async (bundle: never, artifactBytes: never, options: never) =>
      (await sigstoreMocks.createVerifier(options)).verify(bundle, artifactBytes),
  };
});

vi.mock("os", async (importOriginal) => {
  const actualOs = await importOriginal<typeof import("os")>();
  return { ...actualOs, homedir: () => installPaths.homeDir };
});

vi.mock("../../cli/cleanup.js", () => ({
  cleanupOldVersions: vi.fn(() => ({ removed: [], freedBytes: 0 })),
  formatBytes: vi.fn((byteCount: number) => `${byteCount} B`),
}));

vi.mock("../../../packages/mcps/src/index.js", async () => {
  const checksumModule = await vi.importActual<typeof import("../../../packages/mcps/src/shared/checksum.js")>(
    "../../../packages/mcps/src/shared/checksum.js",
  );
  const executableModule = await vi.importActual<
    typeof import("../../../packages/mcps/src/shared/electron-app-executable.js")
  >("../../../packages/mcps/src/shared/electron-app-executable.js");
  const { join: joinPath } = await vi.importActual<typeof import("node:path")>("node:path");
  const signedReleaseFixture = JSON.parse(
    (await vi.importActual<typeof import("node:fs")>("node:fs")).readFileSync(
      new URL("../../../test/fixtures/release-integrity/signed-release.json", import.meta.url),
      "utf-8",
    ),
  ) as { signerIdentityUri: string };

  return {
    ...executableModule,
    calculateFileChecksum: checksumModule.calculateFileChecksum,
    verifyFileChecksum: checksumModule.verifyFileChecksum,
    buildElectronAppChecksumsUrl: () => "https://release.test/checksums.txt",
    buildElectronAppReleaseAssetUrl: (assetParams: { assetFileName: string }) =>
      `https://release.test/${assetParams.assetFileName}`,
    DEFAULT_PREFERENCES: {},
    getChecksumForPlatform: () => releaseState.checksum,
    getDataDir: () => installPaths.dataDir,
    getElectronAppChecksums: () => ({}),
    getElectronAppDir: (version: string) => joinPath(installPaths.dataDir, "electron-app", version),
    getElectronAppReleaseTagPrefix: () => "electron-app-v",
    getElectronAppSignedFromVersion: () => "1.0.0",
    getElectronAppVersion: () => "2.0.0",
    getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    getPlatformKey: () => "fixture-platform",
    getReleaseSignerIdentityUri: () => signedReleaseFixture.signerIdentityUri,
    isElectronAppInstalled: () => false,
    isFirstRun: () => false,
    PREFERENCES_FILE_NAME: "preferences.json",
    ProjectPreferencesReconcileOutcome: { CopiedToGlobal: "copiedToGlobal" },
    reconcileProjectPreferences: () => ({ outcome: "noAction" }),
    writePreferences: vi.fn(),
  };
});

import { PolicyError, VerificationError } from "sigstore";

import {
  CORE_UNREACHABLE_FAILURES,
  UNCLASSIFIABLE_FAILURES,
} from "../../../test/fixtures/release-integrity/trust-root-failures.js";
import { setupCommand } from "../../cli/setup.js";
import { upgradeCommand } from "../../cli/upgrade.js";

const STUDIO_VERSION = "2.0.0";
const TRUST_ROOT_HOST = "tuf-repo-cdn.sigstore.dev";
const VERIFIED_MESSAGE = "Signature verified successfully.";
const ASSET_NAMES = ["MuggleAI-win32-x64.zip", "MuggleAI-darwin-x64.zip", "MuggleAI-darwin-arm64.zip", "MuggleAI-linux-x64.zip"];
const EXECUTABLE_PATH_SEGMENTS: Record<string, string[]> = {
  win32: ["MuggleAI.exe"],
  linux: ["muggle-ai-studio"],
  darwin: ["MuggleAI.app", "Contents", "MacOS", "MuggleAI"],
};

const signedRelease = JSON.parse(
  readFileSync(new URL("../../../test/fixtures/release-integrity/signed-release.json", import.meta.url), "utf-8"),
) as {
  archiveBase64: string;
  archiveSha256: string;
  bundle: { messageSignature: { messageDigest: { digest: string }; signature: string } };
  wrongIdentityBundle: unknown;
};
const signedArchive = Buffer.from(signedRelease.archiveBase64, "base64");
const fixtureExecutableContent = "fixture studio executable\n";

/** What the fake release serves; each test overrides only what it is about. */
interface IFakeRelease {
  archive: Buffer;
  archiveStatus: number;
  bundleResponse: () => Response;
  checksumsStatus: number;
}

/** Answers every request an install makes from the fake release. */
function serveRelease(fakeRelease: IFakeRelease): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (requestUrl: string) => {
      const url = String(requestUrl);

      if (url.includes("api.github.com")) {
        const releaseAssetNames = [
          ...ASSET_NAMES,
          ...ASSET_NAMES.map((assetName) => `${assetName}.sigstore.json`),
          "checksums.txt",
        ];
        return Response.json([{
          tag_name: `electron-app-v${STUDIO_VERSION}`,
          prerelease: false,
          draft: false,
          assets: releaseAssetNames.map((assetName) => ({ name: assetName, state: "uploaded" })),
        }]);
      }
      if (url.endsWith("checksums.txt")) {
        const checksumLines = ASSET_NAMES.map((assetName) => `${releaseState.checksum}  ${assetName}`).join("\n");
        return new Response(checksumLines, { status: fakeRelease.checksumsStatus });
      }
      if (url.endsWith(".sigstore.json")) {
        return fakeRelease.bundleResponse();
      }
      return fakeRelease.archiveStatus === 200
        ? new Response(new Uint8Array(fakeRelease.archive))
        : new Response("", { status: fakeRelease.archiveStatus, statusText: "Failed" });
    }),
  );
}

/** Serves a bundle as a release would. */
function bundleResponseOf(bundle: unknown): () => Response {
  return () => Response.json(bundle);
}

/** Returns the good bundle with one change applied. */
function alteredBundle(applyChange: (bundleCopy: typeof signedRelease.bundle) => void): unknown {
  const bundleCopy = structuredClone(signedRelease.bundle);
  applyChange(bundleCopy);
  return bundleCopy;
}

/** Flips the first byte of a base64 value. */
function flipFirstByte(base64Value: string): string {
  const valueBytes = Buffer.from(base64Value, "base64");
  valueBytes[0] ^= 0xff;
  return valueBytes.toString("base64");
}

/** Reads a directory into `path -> content`, so two states can be compared exactly. */
function readTree(rootDir: string): Record<string, string> {
  const tree: Record<string, string> = {};
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else {
        tree[relative(rootDir, entryPath)] = readFileSync(entryPath, "utf-8");
      }
    }
  };
  visit(rootDir);
  return tree;
}

const INSTALL_COMMANDS: Array<[string, () => Promise<void>, string]> = [
  ["muggle upgrade --force", () => upgradeCommand({ force: true }), "Upgrade failed"],
  ["muggle setup --force", () => setupCommand({ force: true }), "Failed to download Electron app"],
];

describe.each(INSTALL_COMMANDS)("%s", (_commandName, runInstallCommand, failureHeadline) => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let versionDir: string;
  let executablePath: string;
  let seededInstall: Record<string, string>;
  let fakeRelease: IFakeRelease;

  const printed = (spy: ReturnType<typeof vi.spyOn>): string =>
    spy.mock.calls.map((callArguments: unknown[]) => String(callArguments[0])).join("\n");

  beforeEach(() => {
    const sandboxDir = mkdtempSync(join(tmpdir(), "mgl-studio-integrity-"));
    installPaths.homeDir = sandboxDir;
    installPaths.dataDir = join(sandboxDir, ".muggle-ai");
    versionDir = join(installPaths.dataDir, "electron-app", STUDIO_VERSION);
    executablePath = join(versionDir, ...EXECUTABLE_PATH_SEGMENTS[process.platform]);

    mkdirSync(dirname(executablePath), { recursive: true });
    writeFileSync(executablePath, "working studio");
    mkdirSync(join(versionDir, "resources"), { recursive: true });
    writeFileSync(join(versionDir, "resources", "app.asar"), "working studio resources");
    writeFileSync(join(versionDir, ".install-metadata.json"), "{\"version\":\"working\"}");
    seededInstall = readTree(versionDir);

    releaseState.checksum = signedRelease.archiveSha256;
    fakeRelease = {
      archive: signedArchive,
      archiveStatus: 200,
      bundleResponse: bundleResponseOf(signedRelease.bundle),
      checksumsStatus: 200,
    };
    serveRelease(fakeRelease);
    sigstoreMocks.createVerifier.mockReset();
    sigstoreMocks.createVerifier.mockResolvedValue({ verify: vi.fn() });

    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((): never => undefined as never));
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    vi.unstubAllGlobals();
    rmSync(installPaths.homeDir, { recursive: true, force: true });
  });

  /** Asserts the install failed and the working Studio is exactly as it was. */
  function expectFailedAndUntouched(expectedReason: string): void {
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(printed(errorSpy)).toContain(failureHeadline);
    expect(printed(errorSpy)).toContain(expectedReason);
    expect(existsSync(versionDir)).toBe(true);
    expect(readTree(versionDir)).toEqual(seededInstall);
    expect(existsSync(join(installPaths.dataDir, "electron-app-version-override.json"))).toBe(false);
    expect(readdirSync(join(installPaths.dataDir, "studio-stage"))).toEqual([]);
  }

  /** Asserts the signature was never reported as proven, on top of a failed install. */
  function expectRefusedAndUntouched(expectedReason: string): void {
    expectFailedAndUntouched(expectedReason);
    expect(printed(logSpy)).not.toContain(VERIFIED_MESSAGE);
  }

  /** Asserts the fixture release replaced the working Studio. */
  function expectReplaced(): void {
    expect(exitSpy).not.toHaveBeenCalled();
    expect(readFileSync(executablePath, "utf-8")).toBe(fixtureExecutableContent);
    expect(existsSync(join(versionDir, "resources", "app.asar"))).toBe(false);
    expect(JSON.parse(readFileSync(join(versionDir, ".install-metadata.json"), "utf-8")).version).toBe(STUDIO_VERSION);
    expect(readdirSync(join(installPaths.dataDir, "studio-stage"))).toEqual([]);
  }

  it("replaces the install, but only after the download is accepted", async () => {
    let installSeenDuringVerification: Record<string, string> = {};
    sigstoreMocks.createVerifier.mockImplementation(async () => {
      installSeenDuringVerification = existsSync(versionDir) ? readTree(versionDir) : {};
      return { verify: vi.fn() };
    });

    await runInstallCommand();

    expect(installSeenDuringVerification).toEqual(seededInstall);
    expect(printed(logSpy)).toContain(VERIFIED_MESSAGE);
    expect(printed(warnSpy)).not.toContain("NOT verified");
    expectReplaced();
  });

  it.each(CORE_UNREACHABLE_FAILURES)("falls back to the checksum on %s", async (_label, buildFailure) => {
    sigstoreMocks.createVerifier.mockRejectedValue(buildFailure());

    await runInstallCommand();

    const warning = printed(warnSpy);
    expect(warning).toContain("NOT verified");
    expect(warning).toContain("network failure");
    expect(warning).toContain(TRUST_ROOT_HOST);
    expect(printed(logSpy)).not.toContain(VERIFIED_MESSAGE);
    expect(printed(logSpy)).toContain("Checksum verified successfully.");
    expectReplaced();
  });

  it.each([
    [
      "a tampered bundle",
      () => new VerificationError({ code: "TLOG_INCLUSION_PROOF_ERROR", message: "bad inclusion proof" }),
      "bad inclusion proof",
    ],
    [
      "a wrong signer identity",
      () => new PolicyError({ code: "UNTRUSTED_SIGNER_ERROR", message: "identity does not match" }),
      "identity does not match",
    ],
    [
      "a bundle failure dressed as a DNS failure",
      () => CORE_UNREACHABLE_FAILURES[0][1]() as Error,
      "error refreshing TUF metadata",
    ],
    [
      "a bundle failure dressed as a timeout",
      () => CORE_UNREACHABLE_FAILURES[2][1]() as Error,
      "error refreshing TUF metadata",
    ],
  ])("refuses %s and keeps the install", async (_label, buildFailure, expectedReason) => {
    sigstoreMocks.createVerifier.mockResolvedValue({
      verify: vi.fn(() => {
        throw buildFailure();
      }),
    });

    await runInstallCommand();

    expectRefusedAndUntouched(expectedReason);
  });

  it("refuses a missing signature and keeps the install", async () => {
    fakeRelease.bundleResponse = () => new Response("", { status: 404 });

    await runInstallCommand();

    expectRefusedAndUntouched("404");
  });

  it("refuses an unreadable signature bundle and keeps the install", async () => {
    fakeRelease.bundleResponse = () => new Response("not a bundle");

    await runInstallCommand();

    expectRefusedAndUntouched("could not fetch signature bundle");
  });

  it.each(UNCLASSIFIABLE_FAILURES)("refuses %s and keeps the install", async (_label, buildFailure) => {
    sigstoreMocks.createVerifier.mockRejectedValue(buildFailure());

    await runInstallCommand();

    expectRefusedAndUntouched(TRUST_ROOT_HOST);
    expect(printed(warnSpy)).not.toContain("NOT verified");
  });

  describe("with the host out of reach", () => {
    beforeEach(() => {
      sigstoreMocks.createVerifier.mockRejectedValue(CORE_UNREACHABLE_FAILURES[0][1]());
    });

    it.each([
      [
        "records a digest for other bytes",
        alteredBundle((bundleCopy) => {
          bundleCopy.messageSignature.messageDigest.digest = flipFirstByte(bundleCopy.messageSignature.messageDigest.digest);
        }),
        "does not match the digest",
      ],
      [
        "carries a corrupted signature",
        alteredBundle((bundleCopy) => {
          bundleCopy.messageSignature.signature = flipFirstByte(bundleCopy.messageSignature.signature);
        }),
        "signature",
      ],
      ["was issued to another signer", signedRelease.wrongIdentityBundle, "not issued to"],
      ["is empty", {}, "missing its digest"],
    ])("refuses a bundle that %s", async (_label, bundle, expectedReason) => {
      fakeRelease.bundleResponse = bundleResponseOf(bundle);

      await runInstallCommand();

      expectRefusedAndUntouched(expectedReason);
      expect(printed(warnSpy)).not.toContain("NOT verified");
    });

    it("refuses a missing signature", async () => {
      fakeRelease.bundleResponse = () => new Response("", { status: 404 });

      await runInstallCommand();

      expectRefusedAndUntouched("404");
    });

    it("refuses when no checksum exists to fall back on", async () => {
      releaseState.checksum = "";
      fakeRelease.checksumsStatus = 404;

      await runInstallCommand();

      expectRefusedAndUntouched("no checksum is available");
    });

    it("refuses when the checksum does not match", async () => {
      releaseState.checksum = "a".repeat(64);

      await runInstallCommand();

      expectRefusedAndUntouched("Checksum verification failed");
      expect(printed(warnSpy)).toContain("NOT verified");
      expect(printed(warnSpy)).not.toContain("continuing on the signature");
    });
  });

  it("keeps the install when the download fails", async () => {
    fakeRelease.archiveStatus = 502;

    await runInstallCommand();

    expectRefusedAndUntouched("502");
  });

  it("keeps the install when the archive cannot be extracted", async () => {
    fakeRelease.archive = Buffer.from("verified bytes that are not an archive");
    releaseState.checksum = createHash("sha256").update(fakeRelease.archive).digest("hex");

    await runInstallCommand();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(readTree(versionDir)).toEqual(seededInstall);
    expect(readdirSync(join(installPaths.dataDir, "studio-stage"))).toEqual([]);
  });

  it("keeps the install when the archive holds no executable", async () => {
    fakeRelease.archive = Buffer.from(
      "UEsDBBQAAAAAAAAAIVxufmAJBgAAAAYAAAAFAAAAb3RoZXJvdGhlcgpQSwECFAAUAAAAAAAAACFcbn5gCQYAAAAGAAAABQAAAAAAAAAAAAAAgAEAAAAAb3RoZXJQSwUGAAAAAAEAAQAzAAAAKQAAAAAA",
      "base64",
    );
    releaseState.checksum = createHash("sha256").update(fakeRelease.archive).digest("hex");

    await runInstallCommand();

    expectFailedAndUntouched("executable not found");
  });
});

describe("muggle setup with nothing installed", () => {
  it("still installs when the host is out of reach, since setup is how a customer recovers", async () => {
    const sandboxDir = mkdtempSync(join(tmpdir(), "mgl-studio-integrity-"));
    installPaths.homeDir = sandboxDir;
    installPaths.dataDir = join(sandboxDir, ".muggle-ai");
    releaseState.checksum = signedRelease.archiveSha256;
    serveRelease({
      archive: signedArchive,
      archiveStatus: 200,
      bundleResponse: bundleResponseOf(signedRelease.bundle),
      checksumsStatus: 200,
    });
    sigstoreMocks.createVerifier.mockReset();
    sigstoreMocks.createVerifier.mockRejectedValue(CORE_UNREACHABLE_FAILURES[0][1]());
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((): never => undefined as never));

    await setupCommand({});

    const executablePath = join(
      installPaths.dataDir,
      "electron-app",
      STUDIO_VERSION,
      ...EXECUTABLE_PATH_SEGMENTS[process.platform],
    );
    expect(exitSpy).not.toHaveBeenCalled();
    expect(readFileSync(executablePath, "utf-8")).toBe(fixtureExecutableContent);
    expect(warnSpy.mock.calls.map((callArguments) => String(callArguments[0])).join("\n")).toContain("NOT verified");

    logSpy.mockRestore();
    warnSpy.mockRestore();
    exitSpy.mockRestore();
    vi.unstubAllGlobals();
    rmSync(sandboxDir, { recursive: true, force: true });
  });
});
