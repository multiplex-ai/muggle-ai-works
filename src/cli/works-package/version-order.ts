import { NUMERIC_IDENTIFIER_PATTERN, PACKAGE_VERSION_PATTERN } from "./constants.js";

function comparePrereleaseIdentifiers(leftIdentifier: string, rightIdentifier: string): number {
  const isLeftNumeric = NUMERIC_IDENTIFIER_PATTERN.test(leftIdentifier);
  const isRightNumeric = NUMERIC_IDENTIFIER_PATTERN.test(rightIdentifier);
  if (isLeftNumeric && isRightNumeric) return Math.sign(Number(leftIdentifier) - Number(rightIdentifier));
  if (isLeftNumeric !== isRightNumeric) return isLeftNumeric ? -1 : 1;
  if (leftIdentifier === rightIdentifier) return 0;
  return leftIdentifier < rightIdentifier ? -1 : 1;
}

function comparePrereleases(leftPrerelease: string | undefined, rightPrerelease: string | undefined): number {
  if (leftPrerelease === rightPrerelease) return 0;
  // A release follows every prerelease of the same release numbers.
  if (leftPrerelease === undefined) return 1;
  if (rightPrerelease === undefined) return -1;
  const leftIdentifiers = leftPrerelease.split(".");
  const rightIdentifiers = rightPrerelease.split(".");
  const sharedLength = Math.min(leftIdentifiers.length, rightIdentifiers.length);
  for (let index = 0; index < sharedLength; index++) {
    const identifierOrder = comparePrereleaseIdentifiers(leftIdentifiers[index], rightIdentifiers[index]);
    if (identifierOrder !== 0) return identifierOrder;
  }
  return Math.sign(leftIdentifiers.length - rightIdentifiers.length);
}

/**
 * Orders two package versions as semver does, so `5.39.0-staging.100` follows `5.39.0-staging.99`.
 *
 * @returns 1 when `leftVersion` is newer, -1 when older, 0 when equal, undefined when either is not a version.
 */
export function compareWorksVersions(leftVersion: string, rightVersion: string): number | undefined {
  const leftParts = PACKAGE_VERSION_PATTERN.exec(leftVersion);
  const rightParts = PACKAGE_VERSION_PATTERN.exec(rightVersion);
  if (!leftParts || !rightParts) return undefined;
  for (const releaseNumberIndex of [1, 2, 3]) {
    const releaseNumberOrder = Math.sign(Number(leftParts[releaseNumberIndex]) - Number(rightParts[releaseNumberIndex]));
    if (releaseNumberOrder !== 0) return releaseNumberOrder;
  }
  return comparePrereleases(leftParts[4], rightParts[4]);
}

/** Whether `candidateVersion` is a version newer than `installedVersion`; false when either is not a version. */
export function isNewerWorksVersion(candidateVersion: string, installedVersion: string): boolean {
  return compareWorksVersions(candidateVersion, installedVersion) === 1;
}
