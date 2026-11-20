import { STAGING_VERSION_MARKER } from "./constants.js";
import { ReleaseLaneTag } from "./types.js";

/**
 * The dist-tag heading the release lane `installedVersion` sits on.
 *
 * Semver orders `5.15.0-staging.106` below `5.15.0`, so a staging build measured against `latest` reads as out of
 * date and would be moved onto stable.
 */
export function resolveReleaseLaneTag(installedVersion: string): ReleaseLaneTag {
  return installedVersion.includes(STAGING_VERSION_MARKER) ? ReleaseLaneTag.Staging : ReleaseLaneTag.Stable;
}
