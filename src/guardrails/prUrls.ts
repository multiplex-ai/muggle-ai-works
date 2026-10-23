import { GITHUB_PR_URL, GITLAB_MR_URL } from "./constants.js";

/**
 * Every GitHub PR and GitLab MR web URL in a text, once each, with any fragment or subpath dropped.
 *
 * Output shape: `["https://github.com/o/r/pull/7", "https://gitlab.com/g/p/-/merge_requests/3"]`
 */
export function extractPrUrls(text: string): string[] {
  const githubPrUrls = [...text.matchAll(new RegExp(GITHUB_PR_URL.source, "g"))];
  const gitlabMrUrls = [...text.matchAll(new RegExp(GITLAB_MR_URL.source, "g"))];
  return [...new Set([...githubPrUrls, ...gitlabMrUrls].map((match) => match[0]))];
}
