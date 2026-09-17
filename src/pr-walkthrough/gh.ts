import { execFileSync } from "child_process";
import { GH_COMMENT_TIMEOUT_MS } from "./constants.js";
import type { GhRunner, PrComment, PrCoordinates } from "./types.js";

const GITHUB_PR_URL = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/;

/**
 * Set to `off` by the test config. Hooks call the real `gh` against whatever PR
 * url a fixture carries, and a fixture naming a live PR would otherwise post to
 * it — so the suite disables the provider wholesale rather than trusting every
 * fixture to name an unreachable repo.
 */
const GH_CALLS_ENV = "MUGGLE_GUARDRAIL_GH_CALLS";

export const defaultGhRunner: GhRunner = (args, input) => {
  if (process.env[GH_CALLS_ENV] === "off") return null;
  try {
    return execFileSync("gh", args, {
      encoding: "utf-8",
      input: input,
      timeout: GH_COMMENT_TIMEOUT_MS,
      stdio: ["pipe", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
};

/** Repo and number behind a GitHub PR url; `null` for anything else, GitLab MRs included. */
export function parsePrUrl(prUrl: string): PrCoordinates | null {
  const parts = prUrl.match(GITHUB_PR_URL);
  if (!parts) return null;
  return { repo: `${parts[1]}/${parts[2]}`, prNumber: Number(parts[3]) };
}

/** Every comment on a PR's conversation, or `null` when the listing could not be read. */
export function listPrComments(pr: PrCoordinates, run: GhRunner): PrComment[] | null {
  let raw: string | null;
  try {
    raw = run(["api", "--paginate", `repos/${pr.repo}/issues/${pr.prNumber}/comments`]);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PrComment[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeJson(args: string[], payload: unknown, run: GhRunner): boolean {
  try {
    return run(args, JSON.stringify(payload)) !== null;
  } catch {
    return false;
  }
}

/** Adds a comment to a PR's conversation. */
export function postPrComment(pr: PrCoordinates, body: string, run: GhRunner): boolean {
  return writeJson(
    ["api", "--method", "POST", `repos/${pr.repo}/issues/${pr.prNumber}/comments`, "--input", "-"],
    { body: body },
    run,
  );
}

/** Replaces one comment's body. */
export function patchPrComment(
  pr: PrCoordinates,
  commentId: number,
  body: string,
  run: GhRunner,
): boolean {
  return writeJson(
    ["api", "--method", "PATCH", `repos/${pr.repo}/issues/comments/${commentId}`, "--input", "-"],
    { body: body },
    run,
  );
}

/**
 * Publishes a completed check run against a commit.
 *
 * A check run rather than the job's own status because the same verdict has to
 * report from an `issue_comment` trigger, whose job runs on the default branch:
 * only an explicit head-sha check reaches the PR from there, so settling the
 * comment turns the check green with no new push.
 */
export function createCheckRun(
  repo: string,
  checkRun: { name: string; headSha: string; conclusion: string; title: string; summary: string },
  run: GhRunner,
): boolean {
  return writeJson(["api", "--method", "POST", `repos/${repo}/check-runs`, "--input", "-"], {
    name: checkRun.name,
    head_sha: checkRun.headSha,
    status: "completed",
    conclusion: checkRun.conclusion,
    output: { title: checkRun.title, summary: checkRun.summary },
  }, run);
}
