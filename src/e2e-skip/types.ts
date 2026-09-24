/**
 * The only reasons a Muggle E2E run may be skipped.
 *
 * Every member names a fact about the *environment*, which is what makes the
 * set verifiable. A judgment about the change under test — "static page",
 * "layout only", "covered by unit tests", "verified with another tool" — has
 * deliberately no member, because a skip the agent can argue for is a skip that
 * happens whenever arguing is cheaper than running.
 */
export enum E2eSkipCode {
  NoWebSurface = "NO_WEB_SURFACE",
  DevServerUnreachable = "DEV_SERVER_UNREACHABLE",
  EmptyDiff = "EMPTY_DIFF",
  MuggleAuthDown = "MUGGLE_AUTH_DOWN",
  NoPr = "NO_PR",
  UserWaived = "USER_WAIVED",
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
