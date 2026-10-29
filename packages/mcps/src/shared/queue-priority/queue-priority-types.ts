/** Types for ordering the local E2E queues at {@link ./queue-priority.ts}. */

/** The open pull request a checkout's branch heads. */
export interface ICheckoutPullRequest {
  number: number;
  url: string;
  /** When the pull request was opened (ms since epoch). */
  createdAt: number;
}

/**
 * Finds the open pull request a checkout's branch heads.
 *
 * @returns The pull request, or null when there is none or it cannot be read.
 */
export type PullRequestLookup = (cwd: string) => Promise<ICheckoutPullRequest | null>;

/** A checkout's place in one of the local E2E queues, as the order reads it. */
export interface IQueuePlace {
  /** The open pull request the waiting checkout belongs to; absent before it has one. */
  pullRequest?: ICheckoutPullRequest | null;
  /** When the checkout first asked (ms since epoch). */
  enqueuedAt: number;
}
