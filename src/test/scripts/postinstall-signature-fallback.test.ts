/* global structuredClone */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const FIXTURES_DIR = join(REPO_ROOT, "test", "fixtures", "release-integrity");
const BLOCK_HOST_PRELOAD = join(FIXTURES_DIR, "block-trust-root-host.cjs");
const STUDIO_VERSION = "2.0.0";
const TRUST_ROOT_HOST = "tuf-repo-cdn.sigstore.dev";
const VERIFIED_MESSAGE = "Signature verified successfully.";
const POSTINSTALL_TIMEOUT_MS = 60_000;
const PLATFORM_KEY_BY_NAME: Record<string, string> = {
  win32: "win32-x64",
  linux: "linux-x64",
  darwin: process.arch === "arm64" ? "darwin-arm64" : "darwin-x64",
};
const EXECUTABLE_PATH_SEGMENTS: Record<string, string[]> = {
  win32: ["MuggleAI.exe"],
  linux: ["muggle-ai-studio"],
  darwin: ["MuggleAI.app", "Contents", "MacOS", "MuggleAI"],
};

const signedRelease = JSON.parse(readFileSync(join(FIXTURES_DIR, "signed-release.json"), "utf-8")) as {
  signerIdentityUri: string;
  archiveBase64: string;
  archiveSha256: string;
  bundle: { messageSignature: { messageDigest: { digest: string } } };
  wrongIdentityBundle: unknown;
};

/** One spawned install: what the release serves and how the host is blocked. */
interface IPostinstallScenario {
  bundle?: unknown;
  expectedChecksum?: string;
  lookupErrorCode: string;
}

/** What a spawned install printed and left behind. */
interface IPostinstallOutcome {
  output: string;
  installedExecutable: string;
}

describe("fresh install (postinstall) with the signature host blocked", () => {
  let packageRoot: string;
  let releaseServer: Server;
  let servedBundle: unknown;

  beforeAll(async () => {
    packageRoot = mkdtempSync(join(tmpdir(), "mgl-postinstall-package-"));
    cpSync(join(REPO_ROOT, "scripts"), join(packageRoot, "scripts"), { recursive: true });
    cpSync(join(REPO_ROOT, "config"), join(packageRoot, "config"), { recursive: true });
    mkdirSync(join(packageRoot, "plugin", "skills"), { recursive: true });
    cpSync(join(REPO_ROOT, "plugin", "skills", "_aliases.json"), join(packageRoot, "plugin", "skills", "_aliases.json"));
    symlinkSync(join(REPO_ROOT, "node_modules"), join(packageRoot, "node_modules"), "junction");

    releaseServer = createServer((request, response) => {
      if ((request.url ?? "").endsWith(".sigstore.json")) {
        if (servedBundle === undefined) {
          response.writeHead(404).end();
          return;
        }
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(servedBundle));
        return;
      }
      response.writeHead(200).end(Buffer.from(signedRelease.archiveBase64, "base64"));
    });
    await new Promise<void>((resolve) => releaseServer.listen(0, "127.0.0.1", resolve));
  });

  afterAll(async () => {
    await new Promise((resolve) => releaseServer.close(resolve));
    // The junction goes first: a recursive delete must never reach the repo's node_modules.
    rmSync(join(packageRoot, "node_modules"), { recursive: false, force: true });
    rmSync(packageRoot, { recursive: true, force: true });
  });

  /** Runs the real postinstall script in a temp home and reports what it did. */
  async function runPostinstall(scenario: IPostinstallScenario): Promise<IPostinstallOutcome> {
    servedBundle = "bundle" in scenario ? scenario.bundle : signedRelease.bundle;
    const homeDir = mkdtempSync(join(tmpdir(), "mgl-postinstall-home-"));
    const { port } = releaseServer.address() as AddressInfo;
    const expectedChecksum = "expectedChecksum" in scenario ? scenario.expectedChecksum : signedRelease.archiveSha256;

    writeFileSync(
      join(packageRoot, "package.json"),
      JSON.stringify({
        name: "@muggleai/works",
        version: "0.0.0",
        muggleConfig: {
          electronAppVersion: STUDIO_VERSION,
          downloadBaseUrl: `http://127.0.0.1:${port}`,
          runtimeTargetDefault: "production",
          checksumsByStream: { production: { [PLATFORM_KEY_BY_NAME[process.platform]]: expectedChecksum } },
          electronAppSignedFromVersion: "1.0.0",
          signerIdentityUri: signedRelease.signerIdentityUri,
        },
      }),
    );

    const postinstall = spawn(
      process.execPath,
      ["--require", BLOCK_HOST_PRELOAD, join(packageRoot, "scripts", "postinstall.mjs")],
      {
        cwd: packageRoot,
        env: {
          ...process.env,
          HOME: homeDir,
          USERPROFILE: homeDir,
          LOCALAPPDATA: join(homeDir, "AppData", "Local"),
          XDG_DATA_HOME: join(homeDir, ".local", "share"),
          TRUST_ROOT_LOOKUP_ERROR_CODE: scenario.lookupErrorCode,
          npm_config_global: "false",
        },
      },
    );

    let output = "";
    postinstall.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    postinstall.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    await new Promise((resolve) => postinstall.on("close", resolve));

    const executablePath = join(
      homeDir,
      ".muggle-ai",
      "electron-app",
      STUDIO_VERSION,
      ...EXECUTABLE_PATH_SEGMENTS[process.platform],
    );
    const installedExecutable = existsSync(executablePath) ? readFileSync(executablePath, "utf-8") : "";
    const installDirEntries = existsSync(join(homeDir, ".muggle-ai", "electron-app"))
      ? readdirSync(join(homeDir, ".muggle-ai", "electron-app"))
      : [];
    rmSync(homeDir, { recursive: true, force: true });

    return { output: `${output}\ninstall dir entries: ${installDirEntries.join(",")}`, installedExecutable: installedExecutable };
  }

  /** Asserts a spawned install refused and left nothing to run. */
  function expectRefused(outcome: IPostinstallOutcome, expectedReason: string): void {
    expect(outcome.output).toContain("refusing to install");
    expect(outcome.output).toContain(expectedReason);
    expect(outcome.output).not.toContain(VERIFIED_MESSAGE);
    expect(outcome.output).not.toContain("Extracting...");
    expect(outcome.installedExecutable).toBe("");
  }

  it.each([
    ["a DNS failure", "ENOTFOUND"],
    ["a connection refusal", "ECONNREFUSED"],
    ["a timeout", "ETIMEDOUT"],
  ])("warns, then installs on the checksum, on %s", async (_label, lookupErrorCode) => {
    const outcome = await runPostinstall({ lookupErrorCode: lookupErrorCode });

    expect(outcome.output).toContain("NOT verified");
    expect(outcome.output).toContain("network failure");
    expect(outcome.output).toContain(TRUST_ROOT_HOST);
    expect(outcome.output).toContain(lookupErrorCode);
    expect(outcome.output).not.toContain(VERIFIED_MESSAGE);
    expect(outcome.output).toContain("Checksum verified successfully.");
    expect(outcome.installedExecutable).toBe("fixture studio executable\n");
  }, POSTINSTALL_TIMEOUT_MS);

  it("refuses a failure it cannot classify as unreachable", async () => {
    const outcome = await runPostinstall({ lookupErrorCode: "ERR_TLS_CERT_ALTNAME_INVALID" });

    expectRefused(outcome, TRUST_ROOT_HOST);
  }, POSTINSTALL_TIMEOUT_MS);

  it("refuses a bundle recording a digest for other bytes", async () => {
    const tamperedBundle = structuredClone(signedRelease.bundle);
    tamperedBundle.messageSignature.messageDigest.digest = Buffer.alloc(32, 1).toString("base64");

    const outcome = await runPostinstall({ lookupErrorCode: "ENOTFOUND", bundle: tamperedBundle });

    expectRefused(outcome, "does not match the digest");
  }, POSTINSTALL_TIMEOUT_MS);

  it("refuses a bundle issued to another signer", async () => {
    const outcome = await runPostinstall({ lookupErrorCode: "ENOTFOUND", bundle: signedRelease.wrongIdentityBundle });

    expectRefused(outcome, "not issued to");
  }, POSTINSTALL_TIMEOUT_MS);

  it("refuses a missing signature", async () => {
    const outcome = await runPostinstall({ lookupErrorCode: "ENOTFOUND", bundle: undefined });

    expectRefused(outcome, "404");
  }, POSTINSTALL_TIMEOUT_MS);

  it("refuses when no checksum is pinned to fall back on", async () => {
    const outcome = await runPostinstall({ lookupErrorCode: "ENOTFOUND", expectedChecksum: "" });

    expectRefused(outcome, "no checksum is available");
  }, POSTINSTALL_TIMEOUT_MS);

  it("refuses when the pinned checksum does not match", async () => {
    const outcome = await runPostinstall({ lookupErrorCode: "ENOTFOUND", expectedChecksum: "a".repeat(64) });

    expect(outcome.output).toContain("NOT verified");
    expect(outcome.output).toContain("Checksum verification failed");
    expect(outcome.installedExecutable).toBe("");
  }, POSTINSTALL_TIMEOUT_MS);
});
