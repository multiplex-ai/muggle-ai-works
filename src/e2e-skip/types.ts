/**
 * The only reasons a Muggle E2E run may be skipped.
 *
 * Every member but one names a fact the guardrail checks for itself — about the
 * *environment*, or about which paths a commit range touched. `NOT_APPLICABLE`
 * is the exception: the agent's own judgment that no browser run can exercise
 * the change (an email template, a backend-only path the UI never reaches). It
 * exists because a change E2E cannot see otherwise keeps a PR red with no way
 * out, and it buys that with honesty instead of verification: it must carry a
 * stated reason, and the PR shows that reason as the agent's, unverified.
 */
export enum E2eSkipCode {
  NoWebSurface = "NO_WEB_SURFACE",
  DevServerUnreachable = "DEV_SERVER_UNREACHABLE",
  EmptyDiff = "EMPTY_DIFF",
  MuggleAuthDown = "MUGGLE_AUTH_DOWN",
  NoPr = "NO_PR",
  UserWaived = "USER_WAIVED",
  NoAppLogicChange = "NO_APP_LOGIC_CHANGE",
  NotApplicable = "NOT_APPLICABLE",
}

/** The detail of a `NO_APP_LOGIC_CHANGE` declaration: the commit the cycle started from, and what the cycle changed. */
export interface NoAppLogicChangeDetail {
  preCycleSha: string;
  /** The base tip the cycle rebased the PR onto, from a `<pre_cycle_sha>..<base_tip_sha>` detail; `null` when the cycle did not rebase. */
  baseTipSha: string | null;
  reason: string;
}

/** Why a skip declaration did not produce a skip. */
export enum SkipRejection {
  MissingCode = "missing-code",
  UnknownCode = "unknown-code",
  VerificationFailed = "verification-failed",
}

/** A parsed `MUGGLE_E2E_SKIP` declaration: the cited code and whatever the caller wrote after it. */
export interface DeclaredSkip {
  code: E2eSkipCode;
  detail: string;
}

/** What a verifier could establish about the environment, and what it saw when it disagreed. */
export interface SkipVerificationResult {
  verified: boolean;
  failure?: string;
}

/**
 * Everything a verifier may read. Passed in rather than reached for so each
 * verifier stays testable without a repo, a network, or a home directory.
 */
export interface SkipVerificationContext {
  cwd?: string;
  prsHandled: string[];
  transcriptPath?: string;
  homeDir: string;
  probe: SkipProbes;
  /** `autoE2ETest` as the user's own preferences file sets it; `always` withdraws the agent's judgment as a skip. */
  userAutoE2ETest?: string;
}

/** The side-effecting lookups verifiers need, injected so tests can supply answers instead of an environment. */
export interface SkipProbes {
  readTextFile: (path: string) => string | null;
  listFiles: (dir: string) => string[];
  runGit: (args: string[], cwd: string) => string | null;
  isReachable: (url: string) => boolean;
}

/** A verifier's judgment on one code, given the environment it was cited in. */
export type SkipVerifier = (context: SkipVerificationContext, detail: string) => SkipVerificationResult;

/**
 * The outcome of judging a declaration.
 *
 * Output shape: `{ accepted: true, skip }`, or
 * `{ accepted: false, rejection, claimedCode?, failure? }`.
 */
export type SkipJudgment =
  | { accepted: true; skip: DeclaredSkip }
  | { accepted: false; rejection: SkipRejection; claimedCode?: string; failure?: string };
