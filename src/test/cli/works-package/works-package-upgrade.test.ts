import { describe, expect, it, vi } from "vitest";

import { NPM_UNAVAILABLE_DETAIL } from "../../../cli/works-package/constants.js";
import { resolveReleaseLaneTag } from "../../../cli/works-package/release-lane.js";
import {
  type INpmCommandOutcome,
  type NpmCommandRunner,
  ReleaseLaneTag,
  WorksPackageUpgradeOutcome,
} from "../../../cli/works-package/types.js";
import { compareWorksVersions, isNewerWorksVersion } from "../../../cli/works-package/version-order.js";
import { describeWorksPackageUpgrade, upgradeWorksPackage } from "../../../cli/works-package/works-package-upgrade.js";

const INSTALL_ARGUMENTS_STAGING = ["install", "-g", "@muggleai/works@staging"];

function globalListing(installedVersion: string | undefined): INpmCommandOutcome {
  const dependencies = installedVersion ? { "@muggleai/works": { version: installedVersion } } : undefined;
  return { exitCode: installedVersion ? 0 : 1, stdout: JSON.stringify({ name: "npm", dependencies: dependencies }), stderr: "" };
}

interface INpmStandIn {
  /** The global install's version on each successive `npm ls`; the last one repeats. */
  installedVersions: Array<string | undefined>;
  /** What `npm view` answers for the lane's dist-tag; undefined when npm cannot be started. */
  laneLookup?: INpmCommandOutcome;
  /** How `npm install -g` ends; undefined when npm cannot be started. */
  install?: INpmCommandOutcome;
}

function npmStandIn(standIn: INpmStandIn): ReturnType<typeof vi.fn<NpmCommandRunner>> {
  let listingCount = 0;
  return vi.fn<NpmCommandRunner>(async (npmArguments) => {
    if (npmArguments[0] === "ls") {
      const listedVersion = standIn.installedVersions[Math.min(listingCount, standIn.installedVersions.length - 1)];
      listingCount += 1;
      return globalListing(listedVersion);
    }
    if (npmArguments[0] === "view") return standIn.laneLookup;
    return standIn.install;
  });
}

const succeeded = (stdout: string): INpmCommandOutcome => ({ exitCode: 0, stdout: stdout, stderr: "" });

describe("resolveReleaseLaneTag", () => {
  it.each([
    ["5.39.0-staging.369", ReleaseLaneTag.Staging],
    ["5.39.0", ReleaseLaneTag.Stable],
    ["5.40.0-beta.1", ReleaseLaneTag.Stable],
    ["5.40.0-rc.2", ReleaseLaneTag.Stable],
  ])("puts %s on %s", (installedVersion, expectedLaneTag) => {
    expect(resolveReleaseLaneTag(installedVersion)).toBe(expectedLaneTag);
  });
});

describe("compareWorksVersions", () => {
  it.each([
    ["5.33.0", "5.32.0", 1],
    ["5.32.0", "5.33.0", -1],
    ["5.32.0", "5.32.0", 0],
    ["5.10.0", "5.9.0", 1],
    ["6.0.0", "5.99.99", 1],
    ["5.39.0-staging.100", "5.39.0-staging.99", 1],
    ["5.39.0-staging.99", "5.39.0-staging.100", -1],
    ["5.39.0-staging.369", "5.39.0-staging.369", 0],
    ["5.39.0-staging.360", "5.38.0-staging.359", 1],
    ["5.40.0", "5.40.0-staging.400", 1],
    ["5.40.0-staging.400", "5.40.0", -1],
    ["5.40.0-staging.1.1", "5.40.0-staging.1", 1],
    ["5.40.0-staging.1", "5.40.0-1", 1],
    ["5.40.0+build.2", "5.40.0+build.1", 0],
  ])("orders %s against %s as %i", (leftVersion, rightVersion, expectedOrder) => {
    expect(compareWorksVersions(leftVersion, rightVersion)).toBe(expectedOrder);
  });

  it.each([
    ["", "5.32.0"],
    ["5.32.0", "npm error code E500"],
    ["5.32", "5.32.0"],
    ["v5.32.0", "5.32.0"],
  ])("has no order for %j against %j", (leftVersion, rightVersion) => {
    expect(compareWorksVersions(leftVersion, rightVersion)).toBeUndefined();
  });
});

describe("isNewerWorksVersion", () => {
  it("is true only for a newer version", () => {
    expect(isNewerWorksVersion("5.39.0-staging.369", "5.39.0-staging.361")).toBe(true);
    expect(isNewerWorksVersion("5.39.0-staging.361", "5.39.0-staging.361")).toBe(false);
    expect(isNewerWorksVersion("5.39.0-staging.360", "5.39.0-staging.361")).toBe(false);
  });

  it("is false when the candidate is not a version", () => {
    expect(isNewerWorksVersion("<html>", "5.39.0")).toBe(false);
  });
});

describe("upgradeWorksPackage", () => {
  it("installs the staging tag for a staging install and reports the versions it moved between", async () => {
    const runNpm = npmStandIn({
      installedVersions: ["5.39.0-staging.361", "5.39.0-staging.369"],
      laneLookup: succeeded("5.39.0-staging.369\n"),
      install: succeeded("changed 1 package"),
    });

    const report = await upgradeWorksPackage({ isCheckOnly: false, runNpm: runNpm });

    expect(report).toEqual({
      outcome: WorksPackageUpgradeOutcome.Updated,
      laneTag: ReleaseLaneTag.Staging,
      fromVersion: "5.39.0-staging.361",
      toVersion: "5.39.0-staging.369",
    });
    const npmCalls = runNpm.mock.calls.map(([npmArguments]) => npmArguments);
    expect(npmCalls).toContainEqual(["view", "@muggleai/works", "dist-tags.staging"]);
    expect(npmCalls).toContainEqual(INSTALL_ARGUMENTS_STAGING);
  });

  it("installs the latest tag for a stable install", async () => {
    const runNpm = npmStandIn({
      installedVersions: ["5.38.0", "5.39.0"],
      laneLookup: succeeded("5.39.0"),
      install: succeeded(""),
    });

    const report = await upgradeWorksPackage({ isCheckOnly: false, runNpm: runNpm });

    expect(report.outcome).toBe(WorksPackageUpgradeOutcome.Updated);
    const npmCalls = runNpm.mock.calls.map(([npmArguments]) => npmArguments);
    expect(npmCalls).toContainEqual(["view", "@muggleai/works", "dist-tags.latest"]);
    expect(npmCalls).toContainEqual(["install", "-g", "@muggleai/works@latest"]);
  });

  it("reports the version npm lists after the install when the tag moved meanwhile", async () => {
    const runNpm = npmStandIn({
      installedVersions: ["5.39.0-staging.361", "5.39.0-staging.370"],
      laneLookup: succeeded("5.39.0-staging.369"),
      install: succeeded(""),
    });

    const report = await upgradeWorksPackage({ isCheckOnly: false, runNpm: runNpm });

    expect(report.toVersion).toBe("5.39.0-staging.370");
  });

  it("installs nothing when the global install is the newest on its lane", async () => {
    const runNpm = npmStandIn({ installedVersions: ["5.39.0-staging.369"], laneLookup: succeeded("5.39.0-staging.369") });

    const report = await upgradeWorksPackage({ isCheckOnly: false, runNpm: runNpm });

    expect(report.outcome).toBe(WorksPackageUpgradeOutcome.AlreadyCurrent);
    expect(runNpm.mock.calls.some(([npmArguments]) => npmArguments[0] === "install")).toBe(false);
  });

  it("never moves a staging install onto a newer stable release", async () => {
    const runNpm = npmStandIn({ installedVersions: ["5.39.0-staging.369"], laneLookup: succeeded("5.39.0-staging.369") });

    await upgradeWorksPackage({ isCheckOnly: false, runNpm: runNpm });

    expect(runNpm.mock.calls.some(([npmArguments]) => npmArguments.includes("dist-tags.latest"))).toBe(false);
  });

  it("reports an available update without installing on a check-only run", async () => {
    const runNpm = npmStandIn({ installedVersions: ["5.38.0"], laneLookup: succeeded("5.39.0") });

    const report = await upgradeWorksPackage({ isCheckOnly: true, runNpm: runNpm });

    expect(report).toEqual({
      outcome: WorksPackageUpgradeOutcome.UpdateAvailable,
      laneTag: ReleaseLaneTag.Stable,
      fromVersion: "5.38.0",
      toVersion: "5.39.0",
    });
    expect(runNpm.mock.calls.some(([npmArguments]) => npmArguments[0] === "install")).toBe(false);
  });

  it("leaves the package alone when npm lists no global install", async () => {
    const runNpm = npmStandIn({ installedVersions: [undefined], laneLookup: succeeded("5.39.0") });

    const report = await upgradeWorksPackage({ isCheckOnly: false, runNpm: runNpm });

    expect(report).toEqual({ outcome: WorksPackageUpgradeOutcome.NotInstalledGlobally });
    expect(runNpm).toHaveBeenCalledTimes(1);
  });

  it("leaves the package alone when the global listing is not JSON", async () => {
    const runNpm = vi.fn<NpmCommandRunner>(async () => succeeded("npm error"));

    const report = await upgradeWorksPackage({ isCheckOnly: false, runNpm: runNpm });

    expect(report.outcome).toBe(WorksPackageUpgradeOutcome.NotInstalledGlobally);
  });

  it.each([
    ["npm cannot be started", undefined],
    ["the registry call fails", { exitCode: 1, stdout: "", stderr: "npm error code ENOTFOUND" }],
    ["the registry answers with no version", succeeded("")],
    ["the registry answers with something that is no version", succeeded("<html>Sign in</html>")],
  ])("installs nothing when %s", async (_caseName, laneLookup) => {
    const runNpm = npmStandIn({ installedVersions: ["5.38.0"], laneLookup: laneLookup });

    const report = await upgradeWorksPackage({ isCheckOnly: false, runNpm: runNpm });

    expect(report).toEqual({
      outcome: WorksPackageUpgradeOutcome.LookupFailed,
      laneTag: ReleaseLaneTag.Stable,
      fromVersion: "5.38.0",
    });
    expect(runNpm.mock.calls.some(([npmArguments]) => npmArguments[0] === "install")).toBe(false);
  });

  it("reports npm's own error when the install fails", async () => {
    const runNpm = npmStandIn({
      installedVersions: ["5.38.0"],
      laneLookup: succeeded("5.39.0"),
      install: { exitCode: 1, stdout: "", stderr: "npm error code EPERM\n" },
    });

    const report = await upgradeWorksPackage({ isCheckOnly: false, runNpm: runNpm });

    expect(report.outcome).toBe(WorksPackageUpgradeOutcome.InstallFailed);
    expect(report.failureDetail).toBe("npm error code EPERM");
  });

  it("says npm was unavailable when the install could not start", async () => {
    const runNpm = npmStandIn({ installedVersions: ["5.38.0"], laneLookup: succeeded("5.39.0"), install: undefined });

    const report = await upgradeWorksPackage({ isCheckOnly: false, runNpm: runNpm });

    expect(report.outcome).toBe(WorksPackageUpgradeOutcome.InstallFailed);
    expect(report.failureDetail).toBe(NPM_UNAVAILABLE_DETAIL);
  });
});

describe("describeWorksPackageUpgrade", () => {
  const versions = { laneTag: ReleaseLaneTag.Staging, fromVersion: "5.39.0-staging.361", toVersion: "5.39.0-staging.369" };

  it("names the versions an update moved from and to", () => {
    expect(describeWorksPackageUpgrade({ outcome: WorksPackageUpgradeOutcome.Updated, ...versions })).toBe(
      "@muggleai/works updated: 5.39.0-staging.361 → 5.39.0-staging.369 (dist-tag staging).",
    );
  });

  it("names the command that installs an available update", () => {
    const description = describeWorksPackageUpgrade({ outcome: WorksPackageUpgradeOutcome.UpdateAvailable, ...versions });
    expect(description).toContain("5.39.0-staging.361 → 5.39.0-staging.369");
    expect(description).toContain("'muggle upgrade'");
  });

  it("names the installed version when it is the newest", () => {
    expect(
      describeWorksPackageUpgrade({ outcome: WorksPackageUpgradeOutcome.AlreadyCurrent, ...versions, toVersion: versions.fromVersion }),
    ).toBe("@muggleai/works 5.39.0-staging.361 is the newest on dist-tag staging.");
  });

  it("says the package was left alone when npm has no global install", () => {
    expect(describeWorksPackageUpgrade({ outcome: WorksPackageUpgradeOutcome.NotInstalledGlobally })).toContain("left alone");
  });

  it("names the version the package stays at when the lookup fails", () => {
    expect(
      describeWorksPackageUpgrade({
        outcome: WorksPackageUpgradeOutcome.LookupFailed,
        laneTag: ReleaseLaneTag.Stable,
        fromVersion: "5.38.0",
      }),
    ).toContain("stays at 5.38.0");
  });

  it("gives the manual install command when npm fails", () => {
    const description = describeWorksPackageUpgrade({
      outcome: WorksPackageUpgradeOutcome.InstallFailed,
      ...versions,
      failureDetail: "npm error code EPERM",
    });
    expect(description).toContain("npm error code EPERM");
    expect(description).toContain("npm install -g @muggleai/works@staging");
  });
});
