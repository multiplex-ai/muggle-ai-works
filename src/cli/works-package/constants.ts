import { WorksPackageUpgradeOutcome } from "./types.js";

/** What a staging build's version carries after its release number, e.g. `5.16.0-staging.109`. */
export const STAGING_VERSION_MARKER = "-staging.";

/** Longest wait for an npm call that only reads: the global listing or a dist-tag. */
export const NPM_LOOKUP_TIMEOUT_MS = 60_000;

/** Longest wait for `npm install -g`, whose postinstall may download the Electron app. */
export const NPM_INSTALL_TIMEOUT_MS = 600_000;

/** Most npm output kept from one call; a failed install can print a long dependency report. */
export const NPM_OUTPUT_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

/** Outcomes that leave the package behind its lane with nothing more the command can do. */
export const FAILED_WORKS_PACKAGE_UPGRADE_OUTCOMES: readonly WorksPackageUpgradeOutcome[] = [
  WorksPackageUpgradeOutcome.LookupFailed,
  WorksPackageUpgradeOutcome.InstallFailed,
];

/**
 * Set to `off` by the test config. `muggle upgrade` installs into the machine's global npm prefix, so the suite
 * disables npm wholesale rather than trusting every test to inject a fake.
 */
export const NPM_COMMANDS_ENV = "MUGGLE_NPM_COMMANDS";

/** Why an install failed when npm left no error output of its own. */
export const NPM_UNAVAILABLE_DETAIL = "npm could not be started or timed out";

/** A prerelease identifier made of digits only, which semver orders by value. */
export const NUMERIC_IDENTIFIER_PATTERN = /^\d+$/;

/** A package version: release numbers, then an optional prerelease and optional build metadata. */
export const PACKAGE_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
