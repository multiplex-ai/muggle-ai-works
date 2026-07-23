import { describe, it, expect } from "vitest";
import { locateGitlabMrProject, locatePrRepo } from "../../watchdog/prLocator.js";

describe("locatePrRepo", () => {
  it("prefers the PR URL", () => {
    expect(
      locatePrRepo({
        url: "https://github.com/multiplex-ai/muggle-ai-works/pull/341",
        repo: "wrong/pair",
      }),
    ).toEqual({ owner: "multiplex-ai", name: "muggle-ai-works" });
  });

  it("falls back to an owner/name repo field when the URL is unusable", () => {
    expect(locatePrRepo({ repo: "multiplex-ai/muggle-ai-brain" })).toEqual({
      owner: "multiplex-ai",
      name: "muggle-ai-brain",
    });
  });

  it("returns null for a legacy owner-less repo field with no URL", () => {
    expect(locatePrRepo({ repo: "muggle-ai-brain" })).toBeNull();
    expect(locatePrRepo({})).toBeNull();
  });
});

describe("locateGitlabMrProject", () => {
  it("splits host and project path on the /-/ segment", () => {
    expect(
      locateGitlabMrProject({ url: "https://gitlab.com/acme/works/-/merge_requests/12" }),
    ).toEqual({ host: "gitlab.com", projectPath: "acme/works" });
  });

  it("keeps nested namespaces of any depth", () => {
    expect(
      locateGitlabMrProject({
        url: "https://gitlab.com/acme/tools/deep/works/-/merge_requests/7",
      }),
    ).toEqual({ host: "gitlab.com", projectPath: "acme/tools/deep/works" });
  });

  it("resolves self-hosted GitLab hosts", () => {
    expect(
      locateGitlabMrProject({ url: "https://git.acme.internal/team/app/-/merge_requests/3" }),
    ).toEqual({ host: "git.acme.internal", projectPath: "team/app" });
  });

  it("returns null for a GitHub PR URL or no URL", () => {
    expect(
      locateGitlabMrProject({ url: "https://github.com/multiplex-ai/muggle-ai-works/pull/341" }),
    ).toBeNull();
    expect(locateGitlabMrProject({})).toBeNull();
  });
});
