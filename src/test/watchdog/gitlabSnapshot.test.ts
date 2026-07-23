import { describe, it, expect } from "vitest";
import { LOOP_REPLY_MARKER } from "../../watchdog/constants.js";
import {
  isGitlabMrConflicting,
  mapGitlabDiscussionsToThreadSnapshots,
  mapGitlabMrStateToPrState,
  mapGitlabPipelineStatusToCiBucket,
} from "../../watchdog/gitlabSnapshot.js";
import { selectActionableThreadIds } from "../../watchdog/signature.js";
import { CiRollupBucket, GitlabDiscussion } from "../../watchdog/types.js";

describe("mapGitlabMrStateToPrState", () => {
  it("maps GitLab lowercase states onto the provider-neutral uppercase ones", () => {
    expect(mapGitlabMrStateToPrState("opened")).toBe("OPEN");
    expect(mapGitlabMrStateToPrState("locked")).toBe("OPEN");
    expect(mapGitlabMrStateToPrState("merged")).toBe("MERGED");
    expect(mapGitlabMrStateToPrState("closed")).toBe("CLOSED");
  });
});

describe("isGitlabMrConflicting", () => {
  it("flags only broken_status and conflict", () => {
    expect(isGitlabMrConflicting("broken_status")).toBe(true);
    expect(isGitlabMrConflicting("conflict")).toBe(true);
  });

  it("treats still-computing and mergeable statuses as not conflicting", () => {
    expect(isGitlabMrConflicting("checking")).toBe(false);
    expect(isGitlabMrConflicting("unchecked")).toBe(false);
    expect(isGitlabMrConflicting("mergeable")).toBe(false);
    expect(isGitlabMrConflicting("")).toBe(false);
  });
});

describe("mapGitlabPipelineStatusToCiBucket", () => {
  it("buckets failed as fail and success-like as pass", () => {
    expect(mapGitlabPipelineStatusToCiBucket("failed")).toBe(CiRollupBucket.Fail);
    expect(mapGitlabPipelineStatusToCiBucket("success")).toBe(CiRollupBucket.Pass);
    expect(mapGitlabPipelineStatusToCiBucket("canceled")).toBe(CiRollupBucket.Pass);
    expect(mapGitlabPipelineStatusToCiBucket("skipped")).toBe(CiRollupBucket.Pass);
    expect(mapGitlabPipelineStatusToCiBucket("manual")).toBe(CiRollupBucket.Pass);
  });

  it("buckets unsettled statuses as pending and no pipeline as none", () => {
    expect(mapGitlabPipelineStatusToCiBucket("running")).toBe(CiRollupBucket.Pending);
    expect(mapGitlabPipelineStatusToCiBucket("pending")).toBe(CiRollupBucket.Pending);
    expect(mapGitlabPipelineStatusToCiBucket("created")).toBe(CiRollupBucket.Pending);
    expect(mapGitlabPipelineStatusToCiBucket("waiting_for_resource")).toBe(CiRollupBucket.Pending);
    expect(mapGitlabPipelineStatusToCiBucket(null)).toBe(CiRollupBucket.None);
    expect(mapGitlabPipelineStatusToCiBucket("")).toBe(CiRollupBucket.None);
  });
});

describe("mapGitlabDiscussionsToThreadSnapshots", () => {
  const unresolvedHumanDiscussion: GitlabDiscussion = {
    id: "D1",
    notes: [
      { body: "please fix this", resolvable: true, resolved: false },
      { body: "second human note", resolvable: true, resolved: false },
    ],
  };
  const resolvedDiscussion: GitlabDiscussion = {
    id: "D2",
    notes: [{ body: "already handled", resolvable: true, resolved: true }],
  };
  const nonResolvableSystemDiscussion: GitlabDiscussion = {
    id: "D3",
    notes: [{ body: "added 1 commit", resolvable: false }],
  };
  const addressedByLoopDiscussion: GitlabDiscussion = {
    id: "D4",
    notes: [
      { body: "please fix that", resolvable: true, resolved: false },
      { body: `done in abc1234 ${LOOP_REPLY_MARKER}`, resolvable: true, resolved: false },
    ],
  };

  it("folds discussions into the provider-neutral thread shape, newest note last", () => {
    const threadSnapshots = mapGitlabDiscussionsToThreadSnapshots([unresolvedHumanDiscussion]);
    expect(threadSnapshots).toEqual([
      {
        threadId: "D1",
        isResolved: false,
        isOutdated: false,
        newestCommentBody: "second human note",
      },
    ]);
  });

  it("reads resolved and non-resolvable discussions as resolved", () => {
    const threadSnapshots = mapGitlabDiscussionsToThreadSnapshots([
      resolvedDiscussion,
      nonResolvableSystemDiscussion,
    ]);
    expect(threadSnapshots.map((snapshot) => snapshot.isResolved)).toEqual([true, true]);
  });

  it("feeds selectActionableThreadIds so only unaddressed human discussions are actionable", () => {
    const actionableThreadIds = selectActionableThreadIds(
      mapGitlabDiscussionsToThreadSnapshots([
        unresolvedHumanDiscussion,
        resolvedDiscussion,
        nonResolvableSystemDiscussion,
        addressedByLoopDiscussion,
      ]),
    );
    expect(actionableThreadIds).toEqual(["D1"]);
  });
});
