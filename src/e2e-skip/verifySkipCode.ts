import { join } from "path";
import {
  BROWSER_FRAMEWORK_PACKAGES,
  MUGGLE_HOME_DIR_NAME,
  OAUTH_SESSION_FILE,
  USER_WAIVE_PHRASE,
  WAIVE_TRANSCRIPT_TAIL_BYTES,
  WEB_SERVER_COMMAND,
  WEB_SURFACE_CONFIG_FILES,
} from "./constants.js";
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
  const head = context.probe.runGit(["symbolic-ref", "refs/remotes/origin/HEAD", "--short"], context.cwd);
  const base = head?.trim();
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
// behalf, which is the whole failure this code exists to make impossible.
const verifyUserWaived: SkipVerifier = (context) => {
  if (!context.transcriptPath) return refuted("no transcript was available to read the waive from");
  const transcript = context.probe.readTextFile(context.transcriptPath);
  if (!transcript) return refuted("the transcript could not be read");
  const tail = transcript.slice(-WAIVE_TRANSCRIPT_TAIL_BYTES);
  const waived = tail.split("\n").some((line) => {
    if (!line.includes(USER_WAIVE_PHRASE)) return false;
    try {
      const entry = JSON.parse(line) as { type?: string; message?: { role?: string; content?: unknown } };
      const isUserTurn = entry.type === "user" || entry.message?.role === "user";
      return isUserTurn && JSON.stringify(entry.message?.content ?? "").includes(USER_WAIVE_PHRASE);
    } catch {
      return false;
    }
  });
  if (waived) return verified;
  return refuted(`no user turn in the transcript contains "${USER_WAIVE_PHRASE}"`);
};

const VERIFIERS: Record<E2eSkipCode, SkipVerifier> = {
  [E2eSkipCode.NoWebSurface]: verifyNoWebSurface,
  [E2eSkipCode.DevServerUnreachable]: verifyDevServerUnreachable,
  [E2eSkipCode.EmptyDiff]: verifyEmptyDiff,
  [E2eSkipCode.MuggleAuthDown]: verifyMuggleAuthDown,
  [E2eSkipCode.NoPr]: verifyNoPr,
  [E2eSkipCode.UserWaived]: verifyUserWaived,
};

/** Run the cited code's verifier against the environment it was cited in. */
export function verifyDeclaredSkip(
  skip: DeclaredSkip,
  context: SkipVerificationContext,
): SkipVerificationResult {
  return VERIFIERS[skip.code](context, skip.detail);
}
