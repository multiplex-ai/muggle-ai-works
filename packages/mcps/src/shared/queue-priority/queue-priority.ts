/**
 * The order both local E2E queues serve waiting checkouts in: the shared
 * service-stack line and the machine-wide execution lock.
 */

import { DEFAULT_LOCAL_STUDIO_JOB_PRIORITY, STUDIO_JOB_PRIORITY_RANK } from "./queue-priority-constants.js";
import type { IQueuePlace } from "./queue-priority-types.js";

/**
 * Compare two places in a local E2E queue. A higher class goes first, so the
 * operator's own acceptance runs are never held behind promotion runs. Within
 * a class, open pull requests go first, the oldest opened first, so the work
 * nearest to merging drains the backlog and a re-run of an older pull request
 * is not sent behind newer ones. Checkouts with no pull request yet follow, in
 * the order they asked.
 *
 * @returns Negative when `left` is served first, positive when `right` is.
 */
export function compareQueuePlaces(left: IQueuePlace, right: IQueuePlace): number {
  const leftRank = STUDIO_JOB_PRIORITY_RANK[left.priority ?? DEFAULT_LOCAL_STUDIO_JOB_PRIORITY];
  const rightRank = STUDIO_JOB_PRIORITY_RANK[right.priority ?? DEFAULT_LOCAL_STUDIO_JOB_PRIORITY];
  if (leftRank !== rightRank) return leftRank - rightRank;
  const leftOpenedAt = left.pullRequest?.createdAt ?? Number.POSITIVE_INFINITY;
  const rightOpenedAt = right.pullRequest?.createdAt ?? Number.POSITIVE_INFINITY;
  if (leftOpenedAt !== rightOpenedAt) return leftOpenedAt < rightOpenedAt ? -1 : 1;
  return left.enqueuedAt - right.enqueuedAt;
}
