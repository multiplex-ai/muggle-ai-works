import { createHash } from "crypto";
import { getInstallId } from "../../packages/mcps/src/shared/install_id.js";
import { parsePrUrl } from "../pr-walkthrough/gh.js";
import { WATCH_QOS_IDENTITY_HEX_LENGTH, WATCH_QOS_IDENTITY_SEPARATOR } from "./constants.js";

/** A PR's reference as every detector spells it: `owner/repo#n`. */
export function prReferenceOf(repo: string, prNumber: number | string): string {
  return `${repo}#${prNumber}`;
}

/** The reference for a PR URL: `owner/repo#n` for a GitHub PR, the URL itself for anything else. */
export function prReferenceOfUrl(prUrl: string): string {
  const coordinates = parsePrUrl(prUrl);
  return coordinates ? prReferenceOf(coordinates.repo, coordinates.prNumber) : prUrl;
}

/**
 * A per-install hash of one identity: stable for the same PR or commit on this machine, unrelatable across installs,
 * and never reversible to a repo, org, number or SHA.
 *
 * @param salt - This install's id.
 */
export function hashWatchQosIdentity(identity: string, salt: string): string {
  return createHash("sha256")
    .update(`${salt}${WATCH_QOS_IDENTITY_SEPARATOR}${identity}`)
    .digest("hex")
    .slice(0, WATCH_QOS_IDENTITY_HEX_LENGTH);
}

/** The salt every identity on this machine is hashed with: the install id telemetry already stamps on each event. */
export function resolveWatchQosSalt(): string {
  return getInstallId();
}
