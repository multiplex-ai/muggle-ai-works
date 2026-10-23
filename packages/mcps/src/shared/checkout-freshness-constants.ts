/** Constants for the checkout-freshness check. */

import { CheckoutFreshnessVerdict } from "./checkout-freshness-types.js";

/** Verdicts that mean the checkout must be synced before anything runs from it. */
export const BLOCKING_FRESHNESS_VERDICTS: ReadonlySet<CheckoutFreshnessVerdict> = new Set([
  CheckoutFreshnessVerdict.BehindBase,
  CheckoutFreshnessVerdict.ForeignBase,
]);

/** Remote whose branches count as the base. */
export const BASE_REMOTE_NAME = "origin";

/** Reflog subject git writes when a branch is created; the remainder names the start point. */
export const BRANCH_CREATION_REFLOG_PREFIX = "branch: Created from ";

/** Length of the abbreviated commit ids a report's reason quotes. */
export const SHORT_SHA_LENGTH = 7;

/** Inherited commits a report names; the rest are only counted. */
export const MAX_LISTED_INHERITED_COMMITS = 20;

/** Ceiling for one git command, sized for a fetch over a slow link. */
export const GIT_COMMAND_TIMEOUT_MS = 30_000;
