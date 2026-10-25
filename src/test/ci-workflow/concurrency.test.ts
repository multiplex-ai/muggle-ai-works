import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { renderUserWorkflow } from "../../ci-workflow/template";
import { USER_WORKFLOW_PATH } from "../../ci-workflow/constants";

const OWN_WORKFLOW = fileURLToPath(new URL(`../../../${USER_WORKFLOW_PATH}`, import.meta.url));
const CONCURRENCY_BLOCK = /^concurrency:\n((?: {2}.*\n)+)/m;

function readConcurrencyBlock(workflow: string, source: string): string {
  const found = workflow.replace(/\r\n/g, "\n").match(CONCURRENCY_BLOCK);
  if (!found) throw new Error(`${source} declares no top-level concurrency block`);
  return found[1];
}

// Settling the walkthrough comment fires an issue_comment run in the same group
// as the pull_request run still checking that PR. Cancelling the in-progress run
// leaves a cancelled `walkthrough-comment` job on the PR head — red on a PR whose
// check just went green — while a run replaced before it starts leaves nothing.
describe("the walkthrough workflow's concurrency", () => {
  it("queues a PR's runs instead of cancelling one in progress", () => {
    const concurrency = readConcurrencyBlock(renderUserWorkflow(), "the ci-install template");
    expect(concurrency).toContain(
      "group: muggle-walkthrough-${{ github.event.pull_request.number || github.event.issue.number }}",
    );
    expect(concurrency).toContain("cancel-in-progress: false");
  });

  it("is the same in this repository's own workflow", () => {
    const ownWorkflow = readFileSync(OWN_WORKFLOW, "utf-8");
    expect(readConcurrencyBlock(ownWorkflow, USER_WORKFLOW_PATH)).toBe(
      readConcurrencyBlock(renderUserWorkflow(), "the ci-install template"),
    );
  });
});
