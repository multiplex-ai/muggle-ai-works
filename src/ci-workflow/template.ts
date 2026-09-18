import { USER_WORKFLOW_COMMAND } from "./constants.js";

/**
 * The walkthrough-check workflow a consuming repository installs.
 *
 * One definition, rendered for both the scaffolder and the documented snippet —
 * a copy in the README is a copy that drifts, so a test pins them equal.
 *
 * No checkout step: the check reads the PR through the GitHub API and never
 * touches the working tree, so a consumer pays a few seconds per run.
 */
export function renderUserWorkflow(): string {
  return `name: muggle-walkthrough

# Every PR owes a settled Muggle AI walkthrough comment: the E2E acceptance
# result, or a stated reason E2E does not apply. The verdict rides a check run
# against the PR head SHA rather than this job's own status, because the
# issue_comment trigger runs against the default branch — only a head-SHA check
# reaches the PR from there, which is what lets settling the comment turn the
# check green with no new push.
#
# GitHub reads the issue_comment trigger from the default branch's copy of this
# file, so comment-driven re-runs only start working once this is merged.
#
# On a pull request from a fork, GITHUB_TOKEN is read-only and the check run
# cannot be published; the command fails open and reports nothing.
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
  issue_comment:
    types: [created, edited]

permissions:
  contents: read
  checks: write
  pull-requests: write

concurrency:
  group: muggle-walkthrough-\${{ github.event.pull_request.number || github.event.issue.number }}
  cancel-in-progress: true

jobs:
  walkthrough-comment:
    # issue_comment fires for plain issues too; only PR conversations matter.
    if: github.event_name == 'pull_request' || github.event.issue.pull_request
    runs-on: ubuntu-latest
    steps:
      - name: Check the walkthrough comment
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: ${USER_WORKFLOW_COMMAND}
`;
}
