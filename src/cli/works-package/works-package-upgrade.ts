import { WORKS_PACKAGE_NAME } from "../../server/docs-resources/constants.js";
import { NPM_INSTALL_TIMEOUT_MS, NPM_LOOKUP_TIMEOUT_MS, NPM_UNAVAILABLE_DETAIL } from "./constants.js";
import { resolveReleaseLaneTag } from "./release-lane.js";
import {
  type IWorksPackageUpgradeParams,
  type IWorksPackageUpgradeReport,
  type NpmCommandRunner,
  WorksPackageUpgradeOutcome,
} from "./types.js";
import { compareWorksVersions } from "./version-order.js";

async function readGloballyInstalledVersion(runNpm: NpmCommandRunner): Promise<string | undefined> {
  const globalListing = await runNpm(["ls", "-g", WORKS_PACKAGE_NAME, "--depth=0", "--json"], NPM_LOOKUP_TIMEOUT_MS);
  if (!globalListing) return undefined;
  try {
    const parsedListing = JSON.parse(globalListing.stdout) as {
      dependencies?: Record<string, { version?: string } | undefined>;
    };
    return parsedListing.dependencies?.[WORKS_PACKAGE_NAME]?.version;
  } catch {
    return undefined;
  }
}

/**
 * Updates npm's global install of the package to the newest version on its own release lane.
 *
 * The lane is read off the version npm has installed, never off the copy that is running, so a checkout or an `npx`
 * run cannot move the global install onto another lane. The lane's tag is installed rather than a version string.
 *
 * Output shape: `{ outcome: "updated", laneTag: "staging", fromVersion: "5.39.0-staging.361", toVersion: "5.39.0-staging.369" }`
 */
export async function upgradeWorksPackage(params: IWorksPackageUpgradeParams): Promise<IWorksPackageUpgradeReport> {
  const installedVersion = await readGloballyInstalledVersion(params.runNpm);
  if (!installedVersion) return { outcome: WorksPackageUpgradeOutcome.NotInstalledGlobally };

  const laneTag = resolveReleaseLaneTag(installedVersion);
  const laneLookup = await params.runNpm(["view", WORKS_PACKAGE_NAME, `dist-tags.${laneTag}`], NPM_LOOKUP_TIMEOUT_MS);
  const newestVersion = laneLookup?.exitCode === 0 ? laneLookup.stdout.trim() : "";
  const versionOrder = compareWorksVersions(newestVersion, installedVersion);
  if (versionOrder === undefined) {
    return { outcome: WorksPackageUpgradeOutcome.LookupFailed, laneTag: laneTag, fromVersion: installedVersion };
  }

  const versions = { laneTag: laneTag, fromVersion: installedVersion, toVersion: newestVersion };
  if (versionOrder <= 0) return { outcome: WorksPackageUpgradeOutcome.AlreadyCurrent, ...versions };
  if (params.isCheckOnly) return { outcome: WorksPackageUpgradeOutcome.UpdateAvailable, ...versions };

  const install = await params.runNpm(["install", "-g", `${WORKS_PACKAGE_NAME}@${laneTag}`], NPM_INSTALL_TIMEOUT_MS);
  if (install?.exitCode !== 0) {
    return {
      outcome: WorksPackageUpgradeOutcome.InstallFailed,
      ...versions,
      failureDetail: install?.stderr.trim() || NPM_UNAVAILABLE_DETAIL,
    };
  }

  // The tag can move between the lookup and the install, so the version reported is the one npm now lists.
  const updatedVersion = (await readGloballyInstalledVersion(params.runNpm)) ?? newestVersion;
  return { outcome: WorksPackageUpgradeOutcome.Updated, ...versions, toVersion: updatedVersion };
}

/** The line `muggle upgrade` prints for the package step, naming the versions it moved from and to. */
export function describeWorksPackageUpgrade(report: IWorksPackageUpgradeReport): string {
  const lane = `dist-tag ${report.laneTag}`;
  switch (report.outcome) {
    case WorksPackageUpgradeOutcome.Updated:
      return `${WORKS_PACKAGE_NAME} updated: ${report.fromVersion} → ${report.toVersion} (${lane}).`;
    case WorksPackageUpgradeOutcome.AlreadyCurrent:
      return `${WORKS_PACKAGE_NAME} ${report.fromVersion} is the newest on ${lane}.`;
    case WorksPackageUpgradeOutcome.UpdateAvailable:
      return `${WORKS_PACKAGE_NAME} update available: ${report.fromVersion} → ${report.toVersion} (${lane}). Run 'muggle upgrade' to install.`;
    case WorksPackageUpgradeOutcome.NotInstalledGlobally:
      return `${WORKS_PACKAGE_NAME} has no npm global install, so the package was left alone. Update it with the package manager that installed it.`;
    case WorksPackageUpgradeOutcome.LookupFailed:
      return `Could not read the newest ${WORKS_PACKAGE_NAME} on ${lane} from npm; the package stays at ${report.fromVersion}.`;
    case WorksPackageUpgradeOutcome.InstallFailed:
      return (
        `npm could not update ${WORKS_PACKAGE_NAME} ${report.fromVersion} → ${report.toVersion}: ${report.failureDetail}\n` +
        `Run 'npm install -g ${WORKS_PACKAGE_NAME}@${report.laneTag}' yourself.`
      );
  }
}
