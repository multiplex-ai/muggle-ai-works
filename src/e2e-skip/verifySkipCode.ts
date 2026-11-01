import { join } from "path";
import {
  BASE_REMOTE,
  BROWSER_FRAMEWORK_PACKAGES,
  MAX_NAMED_APP_LOGIC_PATHS,
  MIN_NOT_APPLICABLE_REASON_WORDS,
  MUGGLE_HOME_DIR_NAME,
  OAUTH_SESSION_FILE,
  USER_WAIVE_PHRASE,
  WAIVE_TRANSCRIPT_TAIL_BYTES,
  WEB_SERVER_COMMAND,
  WEB_SURFACE_CONFIG_FILES,
} from "./constants.js";
import { readRemoteHeadBranch } from "../git-dir/gitDir.js";
import { userAuthoredTextsContaining } from "../transcript/userTurns.js";
import { ALWAYS_PREFERENCE_VALUE } from "../pr-watch/constants.js";
import { isNonAppPath, parseNoAppLogicChangeDetail, pathsWithChangedPatch } from "./noAppLogicChange.js";
import {
  E2eSkipCode,
  type DeclaredSkip,
  type SkipVerificationContext,
  type SkipVerificationResult,
  type SkipVerifier,
} from "./types.js";

const verified: SkipVerificationResult = { verified: true };
const refuted = (failure: string): SkipVerificationResult => ({ verified: false, failure: failure });

const URL_IN_DETAIL = /https?:\/\/[^\s"']+|localhost:\d+/i;

interface Manifest {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const parseManifest = (manifest: string | null): Manifest => {
  if (!manifest) return {};
  try {
    return JSON.parse(manifest) as Manifest;
  } catch {
    return {};
  }
};

const verifyNoWebSurface: SkipVerifier = (context) => {
  if (!context.cwd) return refuted("no working directory was available to inspect");
  const manifest = parseManifest(context.probe.readTextFile(join(context.cwd, "package.json")));

  const serving = Object.entries(manifest.scripts ?? {}).find(([, command]) =>
    WEB_SERVER_COMMAND.test(command),
  );
  if (serving) return refuted(`the "${serving[0]}" script runs a web server (${serving[1]})`);

  const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
  const framework = BROWSER_FRAMEWORK_PACKAGES.find((name) => name in dependencies);
  if (framework) return refuted(`${framework} is a declared dependency`);

  const config = WEB_SURFACE_CONFIG_FILES.find(
    (file) => context.probe.readTextFile(join(context.cwd as string, file)) !== null,
  );
  if (config) return refuted(`the repo contains ${config}`);
  return verified;
};

const verifyDevServerUnreachable: SkipVerifier = (context, detail) => {
  const url = detail.match(URL_IN_DETAIL)?.[0];
  if (!url) return refuted("the detail names no url to probe");
  if (context.probe.isReachable(url)) return refuted(`${url} answered the probe`);
  return verified;
};

const verifyEmptyDiff: SkipVerifier = (context) => {
  if (!context.cwd) return refuted("no working directory was available to inspect");
  const base = (
    readRemoteHeadBranch(context.cwd, BASE_REMOTE, context.probe.readTextFile) ??
    context.probe.runGit(["symbolic-ref", `refs/remotes/${BASE_REMOTE}/HEAD`, "--short"], context.cwd)
  )?.trim();
  if (!base) return refuted("the repo's base branch could not be resolved");
  const diff = context.probe.runGit(["diff", `${base}...HEAD`, "--stat"], context.cwd);
  if (diff === null) return refuted("the diff against the base branch could not be read");
  if (diff.trim()) return refuted(`the branch carries a diff against ${base}`);
  return verified;
};

const liveSessionExpiry = (session: string | null): string | null => {
  if (!session) return null;
  try {
    const expiresAt = (JSON.parse(session) as { expiresAt?: string }).expiresAt;
    if (!expiresAt) return null;
    const expiry = Date.parse(expiresAt);
    return !Number.isNaN(expiry) && expiry > Date.now() ? expiresAt : null;
  } catch {
    return null;
  }
};

const verifyMuggleAuthDown: SkipVerifier = (context) => {
  const muggleHome = join(context.homeDir, MUGGLE_HOME_DIR_NAME);
  const sessionFiles = context.probe.listFiles(muggleHome).filter((name) => OAUTH_SESSION_FILE.test(name));
  for (const name of sessionFiles) {
    const expiresAt = liveSessionExpiry(context.probe.readTextFile(join(muggleHome, name)));
    if (expiresAt) return refuted(`${name} holds a session valid until ${expiresAt}`);
  }
  return verified;
};

const verifyNoPr: SkipVerifier = (context) => {
  if (context.prsHandled.length === 0) return verified;
  return refuted(`this session handled ${context.prsHandled.join(", ")}`);
};

// The waive must be the user's own literal, read back out of the transcript.
// Anything softer — an inferred go-ahead, an impatient aside, the agent's own
// summary of what the user probably meant — is the agent waiving on the user's
// behalf, which is the whole failure this code exists to make impossible. So is
// the phrase arriving in a tool result or a loaded skill: e2e-acceptance.md
// names it, and reading that file once must not waive anything.
const verifyUserWaived: SkipVerifier = (context) => {
  if (!context.transcriptPath) return refuted("no transcript was available to read the waive from");
  const transcript = context.probe.readTextFile(context.transcriptPath);
  if (!transcript) return refuted("the transcript could not be read");
  const tail = transcript.slice(-WAIVE_TRANSCRIPT_TAIL_BYTES);
  if (userAuthoredTextsContaining(tail, USER_WAIVE_PHRASE).length > 0) return verified;
  return refuted(`no user turn in the transcript contains "${USER_WAIVE_PHRASE}"`);
};

const namePaths = (paths: string[]): string => {
  const named = paths.slice(0, MAX_NAMED_APP_LOGIC_PATHS).join(", ");
  const unnamed = paths.length - MAX_NAMED_APP_LOGIC_PATHS;
  return unnamed > 0 ? `${named} and ${unnamed} more` : named;
};

// A rebase moves HEAD onto code its own PRs already tested, so the claim is
// about the PR's own patch against the base, before the replay and after.
// `<base>...<rev>` diffs a revision against its merge base with the base tip —
// the old fork point for the pre-cycle head, the base tip itself for the
// rebased one — so the comparison needs no merge-base lookups. Zero context
// keeps a resolution that merged the PR's lines with the base's neighbouring
// ones from reading as a change to the PR's own edit.
const verifyRebasedNoAppLogicChange = (
  context: SkipVerificationContext,
  preCycleSha: string,
  baseTipSha: string,
): SkipVerificationResult => {
  const cwd = context.cwd as string;
  const isRebased = context.probe.runGit(["merge-base", "--is-ancestor", `${baseTipSha}^{commit}`, "HEAD"], cwd) !== null;
  if (!isRebased) {
    return refuted(`HEAD does not contain ${baseTipSha} — declare the skip once the rebase onto it is on HEAD`);
  }
  const patchAgainstBase = (revision: string): string | null =>
    context.probe.runGit(
      ["-c", "core.quotePath=false", "diff", "-U0", "--no-renames", "--no-color", `${baseTipSha}...${revision}`],
      cwd,
    );
  const before = patchAgainstBase(preCycleSha);
  const after = before === null ? null : patchAgainstBase("HEAD");
  if (before === null || after === null) {
    return refuted(`${preCycleSha} does not resolve to a commit here, or the PR's patch against ${baseTipSha} could not be read`);
  }
  const appLogicPaths = pathsWithChangedPatch(before, after).filter((path) => !isNonAppPath(path));
  if (appLogicPaths.length > 0) {
    return refuted(`the rebase onto ${baseTipSha} changed this PR's own patch on app-logic paths: ${namePaths(appLogicPaths)}`);
  }
  return verified;
};

// The claim is about trees, not ancestry: the app code at HEAD is byte-for-byte
// the app code at the cited commit. Renames are split into a delete and an add
// so moving a source file into docs/ still names the source path it removed.
// One git call, peeling the SHA to a commit inline, because every child process
// in a hook shares one short budget.
const verifyNoAppLogicChange: SkipVerifier = (context, detail) => {
  if (!context.cwd) return refuted("no working directory was available to inspect");
  const declared = parseNoAppLogicChangeDetail(detail);
  if (!declared) {
    return refuted(
      "the detail names no pre-cycle commit — cite it as NO_APP_LOGIC_CHANGE: <sha> <what changed>, " +
        "or after a rebase as NO_APP_LOGIC_CHANGE: <rebase_sha>..<base_tip_sha> <what changed>",
    );
  }
  if (declared.baseTipSha) return verifyRebasedNoAppLogicChange(context, declared.preCycleSha, declared.baseTipSha);
  const sha = declared.preCycleSha;
  const diff = context.probe.runGit(
    ["diff", "--name-only", "--no-renames", "-z", `${sha}^{commit}`, "HEAD"],
    context.cwd,
  );
  if (diff === null) return refuted(`${sha} does not resolve to a commit here, or its diff to HEAD could not be read`);
  const changedPaths = diff.split("\0").filter(Boolean);
  if (changedPaths.length === 0) {
    return refuted(`HEAD carries no change since ${sha} — declare the skip once the cycle's commits are on HEAD`);
  }
  const appLogicPaths = changedPaths.filter((path) => !isNonAppPath(path));
  if (appLogicPaths.length > 0) return refuted(`app-logic paths changed since ${sha}: ${namePaths(appLogicPaths)}`);
  return verified;
};

// Nothing about the environment can confirm this one, so what is checked is the
// reason itself: there has to be one a reviewer can weigh, since the PR shows it
// in place of a run.
const verifyNotApplicable: SkipVerifier = (context, detail) => {
  // The one code backed by nothing but the agent's judgment, and `always` is the
  // user saying that judgment is not theirs to make.
  if (context.userAutoE2ETest === ALWAYS_PREFERENCE_VALUE) {
    return refuted(
      `autoE2ETest=always in ~/.muggle-ai/preferences.json, so a judgment that the change needs no run is not a ` +
        `skip the user allows — run the E2E, or cite a code Muggle can verify`,
    );
  }
  const words = detail.trim().split(/\s+/).filter(Boolean).length;
  if (words >= MIN_NOT_APPLICABLE_REASON_WORDS) return verified;
  return refuted(
    `the reason is ${words === 0 ? "missing" : "too short to weigh"} — cite it as ` +
      `NOT_APPLICABLE: <why a browser run cannot exercise this change>, in at least ${MIN_NOT_APPLICABLE_REASON_WORDS} words`,
  );
};

const VERIFIERS: Record<E2eSkipCode, SkipVerifier> = {
  [E2eSkipCode.NoWebSurface]: verifyNoWebSurface,
  [E2eSkipCode.DevServerUnreachable]: verifyDevServerUnreachable,
  [E2eSkipCode.EmptyDiff]: verifyEmptyDiff,
  [E2eSkipCode.MuggleAuthDown]: verifyMuggleAuthDown,
  [E2eSkipCode.NoPr]: verifyNoPr,
  [E2eSkipCode.UserWaived]: verifyUserWaived,
  [E2eSkipCode.NoAppLogicChange]: verifyNoAppLogicChange,
  [E2eSkipCode.NotApplicable]: verifyNotApplicable,
};

/** Run the cited code's verifier against the environment it was cited in. */
export function verifyDeclaredSkip(
  skip: DeclaredSkip,
  context: SkipVerificationContext,
): SkipVerificationResult {
  return VERIFIERS[skip.code](context, skip.detail);
}
