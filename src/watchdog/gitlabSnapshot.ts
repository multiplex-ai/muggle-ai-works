import { CiRollupBucket, GitlabDiscussion, ReviewThreadSnapshot } from "./types.js";

// _shared/vcs/gitlab/mr-metadata.md: "checking"/"unchecked" means GitLab is
// still computing — treat as not-conflicting this scan.
const GITLAB_CONFLICTING_MERGE_STATUSES = new Set(["broken_status", "conflict"]);

// _shared/vcs/gitlab/mr-pipeline.md buckets, applied to the pipeline-level
// status: canceled/skipped/manual never settle red on their own, so they are
// green for spawn purposes.
const GITLAB_GREEN_PIPELINE_STATUSES = new Set(["success", "canceled", "skipped", "manual"]);

export function mapGitlabMrStateToPrState(gitlabMrState: string): string {
  if (gitlabMrState === "merged") return "MERGED";
  if (gitlabMrState === "closed") return "CLOSED";
  return "OPEN";
}

export function isGitlabMrConflicting(detailedMergeStatus: string): boolean {
  return GITLAB_CONFLICTING_MERGE_STATUSES.has(detailedMergeStatus);
}

export function mapGitlabPipelineStatusToCiBucket(pipelineStatus: string | null): CiRollupBucket {
  if (pipelineStatus === null || pipelineStatus === "") return CiRollupBucket.None;
  if (pipelineStatus === "failed") return CiRollupBucket.Fail;
  if (GITLAB_GREEN_PIPELINE_STATUSES.has(pipelineStatus)) return CiRollupBucket.Pass;
  return CiRollupBucket.Pending;
}

/**
 * GitLab discussions folded into the provider-neutral thread shape
 * (_shared/vcs/gitlab/unresolved-discussions.md): a discussion is resolvable
 * when its first note is, unresolved while any note is, and its newest note
 * body carries the marker classification. Non-resolvable discussions (MR
 * description, system notes) read as resolved so they are never actionable.
 * GitLab exposes no outdated flag, so isOutdated is always false.
 */
export function mapGitlabDiscussionsToThreadSnapshots(
  discussions: GitlabDiscussion[],
): ReviewThreadSnapshot[] {
  return discussions.map((discussion) => {
    const isResolvable = discussion.notes[0]?.resolvable === true;
    const isUnresolved = isResolvable && discussion.notes.some((note) => note.resolved === false);
    return {
      threadId: discussion.id,
      isResolved: !isUnresolved,
      isOutdated: false,
      newestCommentBody: discussion.notes[discussion.notes.length - 1]?.body ?? "",
    };
  });
}
