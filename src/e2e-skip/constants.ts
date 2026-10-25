import { E2eSkipCode } from "./types.js";

// Anchored to a leading echo for the same reason the marker itself is: a grep, a
// commit, or a skill edit that merely mentions the token must not be read as a
// declaration. Everything after the colon is captured raw and judged separately,
// so a declaration that states no code is a *rejection* rather than a non-match —
// the difference between "not a skip attempt" and "a skip attempt that failed".
export const E2E_SKIP_DECLARATION = /^\s*echo\s+["']?MUGGLE_E2E_SKIP:(.*)$/;

/** Splits the cited code off the detail; a code runs to the first colon or space. */
export const SKIP_CODE_TOKEN = /^[\s:]*([A-Za-z_]+)/;

/** Every code, keyed by its wire spelling, for parsing and for the CLI's help text. */
export const E2E_SKIP_CODES: readonly E2eSkipCode[] = Object.values(E2eSkipCode);

/** The categories {@link NON_APP_PATH_PATTERNS} covers, as a reader-facing phrase. */
export const NON_APP_PATH_SUMMARY = "docs, tests, lint/format config, or CI config";

/** What each code asserts, shown in a rejection so the next attempt cites a code that fits rather than rewording the prose. */
export const E2E_SKIP_CODE_CLAIMS: Record<E2eSkipCode, string> = {
  [E2eSkipCode.NoWebSurface]: "the repo ships no web surface to drive",
  [E2eSkipCode.DevServerUnreachable]: "the named dev server does not answer",
  [E2eSkipCode.EmptyDiff]: "the branch carries no diff against its base",
  [E2eSkipCode.MuggleAuthDown]: "the stored Muggle session is missing or expired",
  [E2eSkipCode.NoPr]: "no pull request was handled this session",
  [E2eSkipCode.UserWaived]: "the user waived E2E in their own words",
  [E2eSkipCode.NoAppLogicChange]: `every path changed since the named commit is ${NON_APP_PATH_SUMMARY}`,
  [E2eSkipCode.NotApplicable]: "a browser run cannot exercise this change, for the reason stated",
};

/**
 * Codes whose fact covers only the commits it was verified against.
 *
 * An environment fact still holds after the next round of edits; "this cycle
 * touched no app logic" does not, so a later unit-green round owes E2E again.
 */
export const CYCLE_SCOPED_SKIP_CODES: readonly E2eSkipCode[] = [E2eSkipCode.NoAppLogicChange];

/** The commit a `NO_APP_LOGIC_CHANGE` detail opens with: an abbreviated or full hex SHA, ended by anything but another word character. */
export const PRE_CYCLE_SHA_TOKEN = /^([0-9a-f]{7,40})(?![0-9a-z_])/i;

/**
 * Repo-relative paths that cannot change what a user's browser runs.
 *
 * `NO_APP_LOGIC_CHANGE` accepts a cycle only when every path it changed matches
 * one of these. The set is a path rule, not a reading of the diff, because a
 * path rule is what the guardrail can verify on its own — so it is deliberately
 * narrow, and anything outside it is app logic, including a comment-only edit
 * in a source file:
 *
 * - docs: `*.md`, `*.markdown`, `*.rst` (not `*.mdx`, which compiles to components);
 * - tests: `*.test.*`, `*.spec.*`, `__tests__/`, `__snapshots__/`, `__mocks__/`,
 *   `test_*.py`, `*_test.py`, `*_test.go`, and a root-level `test/` or `tests/`
 *   (a nested `test/` can be a route);
 * - lint/format config: ESLint, Prettier and Stylelint config and ignore files,
 *   markdownlint config, `biome.json(c)`, `.editorconfig`;
 * - CI config: `.github/workflows/`, `.gitlab-ci.yml`.
 */
export const NON_APP_PATH_PATTERNS: readonly RegExp[] = [
  /\.(md|markdown|rst)$/i,
  /(^|\/)[^/]+\.(test|spec)\.[^/]+$/,
  /(^|\/)(__tests__|__snapshots__|__mocks__)\//,
  /(^|\/)test_[^/]+\.py$/,
  /(^|\/)[^/]+_test\.(py|go)$/,
  /^tests?\//,
  /(^|\/)\.(eslintrc|prettierrc|stylelintrc)(\.[a-z]+)?$/,
  /(^|\/)(eslint|prettier|stylelint)\.config\.[cm]?[jt]s$/,
  /(^|\/)\.(eslint|prettier|stylelint)ignore$/,
  /(^|\/)\.markdownlint[^/]*$/,
  /(^|\/)(biome\.jsonc?|\.editorconfig)$/,
  /^\.github\/workflows\//,
  /^\.gitlab-ci\.yml$/,
];

/** How many offending paths a `NO_APP_LOGIC_CHANGE` refutation names before summarizing the rest as a count. */
export const MAX_NAMED_APP_LOGIC_PATHS = 5;

/**
 * The literal the user types to waive E2E.
 *
 * A literal is the point: an agent cannot infer a waive from tone, from
 * impatience, or from its own reading of the task, and the transcript either
 * contains these words or it does not.
 */
export const USER_WAIVE_PHRASE = "SKIP E2E";

/** How much of the transcript tail the waive check reads. A waive applies to the turn it was given in, and a session transcript grows to megabytes. */
export const WAIVE_TRANSCRIPT_TAIL_BYTES = 64_000;

/**
 * Fewest words a `NOT_APPLICABLE` reason may hold. The reason is the only thing
 * standing behind that skip, so a bare "n/a" or "backend" is refused: a reviewer
 * has to be able to read why E2E cannot see the change.
 */
export const MIN_NOT_APPLICABLE_REASON_WORDS = 4;

/** Ceiling on the dev-server probe. A verifier runs inside a tool call, so an unreachable host must fail fast rather than hold the session. */
export const DEV_SERVER_PROBE_TIMEOUT_MS = 2_000;

/** Ceiling on each `git` lookup a verifier runs, for the same reason: a repo locked by another git process must not hold the session. */
export const GIT_PROBE_TIMEOUT_MS = 5_000;

// What means a repo has something a browser can drive.
//
// The signal is deliberately not "declares a dev script": a CLI or an MCP
// server declares `dev` too (this repo's is `tsx watch src/index.ts`), and
// treating that as a web surface would refuse a legitimate skip — a guard that
// misfires on honest work is a guard that gets worked around. So the script's
// *command* must name a known web dev server, or a browser framework must be a
// declared dependency, or a framework config must sit in the tree.
export const WEB_SERVER_COMMAND =
  /\b(vite|next\s+(dev|start)|react-scripts|ng\s+serve|nuxt|astro\s+dev|remix\s+dev|webpack(-dev)?-server|http-server|serve\s+-s|gatsby\s+develop|vue-cli-service\s+serve)\b/;

export const BROWSER_FRAMEWORK_PACKAGES = [
  "react-dom",
  "next",
  "vue",
  "svelte",
  "@angular/core",
  "nuxt",
  "astro",
  "@remix-run/react",
  "preact",
  "solid-js",
] as const;
export const WEB_SURFACE_CONFIG_FILES = [
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "vite.config.js",
  "vite.config.ts",
  "index.html",
  "public/index.html",
] as const;

// The MCP layer stores one session file per runtime target
// (`oauth-session.json`, `oauth-session-staging.json`, …), and which target is
// live is not knowable from a hook. So the auth check reads them all and
// refutes on any valid one: claiming auth is down while a usable session sits
// on disk is the mistake worth being strict about.
export const OAUTH_SESSION_FILE = /^oauth-session[\w.-]*\.json$/;

/** Where the MCP layer keeps its session files, relative to the home directory. */
export const MUGGLE_HOME_DIR_NAME = ".muggle-ai";
