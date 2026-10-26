import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildQuarantineValue,
  countSymbolicLinks,
  listPinnedMacArchives,
} from "../../../scripts/verify-studio-mac-gatekeeper/verify-studio-mac-gatekeeper.mjs";

const { streams } = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../config/runtime-targets.json", import.meta.url)), "utf-8"),
) as { streams: Record<string, { electronAppReleaseTagPrefix: string }> };

const publishWorkflow = readFileSync(
  fileURLToPath(new URL("../../../.github/workflows/publish-works-to-npm.yml", import.meta.url)),
  "utf-8",
).replace(/\r\n/g, "\n");

const DOWNLOAD_BASE_URL = "https://github.com/multiplex-ai/muggle-ai-works/releases/download";

const buildMuggleConfig = (checksumsByStream: Record<string, Record<string, string>>) => ({
  electronAppVersion: "1.16.0",
  downloadBaseUrl: DOWNLOAD_BASE_URL,
  checksumsByStream: checksumsByStream,
});

const FULL_STREAM_PIN = {
  "darwin-arm64": "a".repeat(64),
  "darwin-x64": "b".repeat(64),
  "linux-x64": "c".repeat(64),
  "win32-x64": "d".repeat(64),
};

describe("listPinnedMacArchives", () => {
  // The gate is only evidence if it assesses the bytes postinstall downloads, so the
  // URL must follow postinstall's `${baseUrl}/${releaseTagPrefix}${version}/${binaryName}`.
  it("lists both macOS archives of every pinned stream at the URL postinstall downloads", () => {
    const pinnedMacArchives = listPinnedMacArchives({
      muggleConfig: buildMuggleConfig({ production: FULL_STREAM_PIN, staging: FULL_STREAM_PIN }),
      streams: streams,
    });

    expect(pinnedMacArchives.map((pinnedMacArchive) => pinnedMacArchive.downloadUrl)).toEqual([
      `${DOWNLOAD_BASE_URL}/electron-app-v1.16.0/MuggleAI-darwin-arm64.zip`,
      `${DOWNLOAD_BASE_URL}/electron-app-v1.16.0/MuggleAI-darwin-x64.zip`,
      `${DOWNLOAD_BASE_URL}/electron-app-staging-v1.16.0/MuggleAI-darwin-arm64.zip`,
      `${DOWNLOAD_BASE_URL}/electron-app-staging-v1.16.0/MuggleAI-darwin-x64.zip`,
    ]);
    expect(pinnedMacArchives[1]).toMatchObject({
      releaseStream: "production",
      platformKey: "darwin-x64",
      pinnedChecksum: FULL_STREAM_PIN["darwin-x64"],
    });
  });

  it("skips a stream that records no checksums", () => {
    const pinnedMacArchives = listPinnedMacArchives({
      muggleConfig: buildMuggleConfig({ production: FULL_STREAM_PIN }),
      streams: streams,
    });

    expect(new Set(pinnedMacArchives.map((pinnedMacArchive) => pinnedMacArchive.releaseStream))).toEqual(
      new Set(["production"]),
    );
  });

  it("refuses a stream that pins some platforms but not a macOS archive", () => {
    const { "darwin-x64": _omittedChecksum, ...pinWithoutIntelMac } = FULL_STREAM_PIN;

    expect(() =>
      listPinnedMacArchives({
        muggleConfig: buildMuggleConfig({ production: pinWithoutIntelMac }),
        streams: streams,
      }),
    ).toThrow("checksumsByStream.production.darwin-x64");
  });
});

describe("countSymbolicLinks", () => {
  let fixtureDirectoryPath = "";

  afterEach(() => {
    rmSync(fixtureDirectoryPath, { recursive: true, force: true });
  });

  // A framework packed by `zip -r` without -y keeps Versions/A and gains a real
  // Versions/Current copy beside it: the layout every flattened release shipped.
  it("counts zero in a framework whose Versions/Current is a copy", () => {
    fixtureDirectoryPath = mkdtempSync(join(tmpdir(), "flattened-framework-"));
    for (const versionDirectoryName of ["A", "Current"]) {
      mkdirSync(join(fixtureDirectoryPath, "Versions", versionDirectoryName), { recursive: true });
      writeFileSync(join(fixtureDirectoryPath, "Versions", versionDirectoryName, "Framework"), "binary");
    }

    expect(countSymbolicLinks({ directoryPath: fixtureDirectoryPath })).toBe(0);
  });

  it("counts Versions/Current when it is a link", () => {
    fixtureDirectoryPath = mkdtempSync(join(tmpdir(), "linked-framework-"));
    mkdirSync(join(fixtureDirectoryPath, "Versions", "A"), { recursive: true });
    // "junction" lets the fixture build on Windows without symlink privileges; POSIX ignores it.
    symlinkSync(join(fixtureDirectoryPath, "Versions", "A"), join(fixtureDirectoryPath, "Versions", "Current"), "junction");

    expect(countSymbolicLinks({ directoryPath: fixtureDirectoryPath })).toBe(1);
  });
});

describe("buildQuarantineValue", () => {
  it("records a browser download: flags, hex timestamp, agent", () => {
    expect(buildQuarantineValue()).toMatch(/^0081;[0-9a-f]+;Safari;$/);
  });
});

describe("the publish workflow gates production on macOS Gatekeeper", () => {
  const publishJob = publishWorkflow.slice(publishWorkflow.indexOf("\n  publish:\n"), publishWorkflow.indexOf("\n  notify-on-failure:\n"));

  it("calls the gate workflow", () => {
    expect(publishWorkflow).toContain("uses: ./.github/workflows/verify-studio-mac-gatekeeper.yml");
  });

  it("makes the npm publish job wait on the gate", () => {
    expect(publishJob).toMatch(/needs:\n(?: {6}- [a-z-]+\n)*? {6}- studio-mac-gatekeeper\n/);
  });

  // A skipped need skips its dependents unless `if:` overrides that, so the override
  // must never let a production publish through a gate that did not run.
  it("lets only a staging publish proceed past a skipped gate", () => {
    expect(publishJob).toContain("needs.studio-mac-gatekeeper.result == 'success'");
    expect(publishJob).toContain(
      "(needs.studio-mac-gatekeeper.result == 'skipped' && inputs.channel == 'staging')",
    );
  });
});
