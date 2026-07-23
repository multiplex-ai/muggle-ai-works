import type { GitlabMrLocator } from "./types.js";

export interface PrRepoLocator {
  owner: string;
  name: string;
}

/**
 * Owner/name for API calls, URL-first: legacy slots wrote `repo` without the
 * owner segment, but every slot's `url` is a full PR link.
 * Returns e.g. { owner: "multiplex-ai", name: "muggle-ai-works" }, or null
 * when neither field is usable.
 */
export function locatePrRepo(prRecord: { url?: string; repo?: string }): PrRepoLocator | null {
  const urlMatch = /github\.com\/([^/]+)\/([^/]+)\/pull\/\d+/.exec(prRecord.url ?? "");
  if (urlMatch) return { owner: urlMatch[1], name: urlMatch[2] };
  const [owner, name] = (prRecord.repo ?? "").split("/");
  if (owner && name) return { owner: owner, name: name };
  return null;
}

/**
 * Host + project path for GitLab API calls, from the MR URL. The `/-/` segment
 * separates project path from resource on any host, and the path may nest to
 * any depth (`group/subgroup/project`) — so split on `/-/`, never assume two
 * segments. Returns e.g. { host: "gitlab.com", projectPath: "acme/tools/works" }.
 */
export function locateGitlabMrProject(prRecord: { url?: string }): GitlabMrLocator | null {
  const urlMatch = /^https?:\/\/([^/]+)\/(.+)\/-\/merge_requests\/\d+/.exec(prRecord.url ?? "");
  if (!urlMatch) return null;
  return { host: urlMatch[1], projectPath: urlMatch[2] };
}
