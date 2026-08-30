#!/usr/bin/env bash
# One read of a pull request's watch-relevant state, shared by the loop that
# polls it and the arm step that seeds its watermark.
#
# Both must see the PR through exactly the same projection: the watermark is a
# set of floors taken from these fields, and a floor read through a different
# shape than the one it is later compared against is worse than no floor at all.
# Keeping the query in one place is what makes "seed from the drain's own read"
# a fact rather than an instruction.

watch_fetch_state() {
    local repo="$1" pr_number="$2" slot="$3" state_projection="$4"
    gh api graphql -F owner="${repo%%/*}" -F name="${repo##*/}" -F number="$pr_number" -f query='
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      state
      headRefOid
      baseRefOid
      mergeable
      commits(last: 1) {
        nodes {
          commit {
            statusCheckRollup {
              contexts(first: 100) {
                nodes {
                  __typename
                  ... on CheckRun { name status conclusion }
                  ... on StatusContext { context state }
                }
              }
            }
          }
        }
      }
      reviews(last: 20, states: [COMMENTED, APPROVED, CHANGES_REQUESTED, DISMISSED]) { nodes { databaseId body } }
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          isOutdated
          comments(last: 1) { nodes { databaseId body pullRequestReview { databaseId state } } }
        }
      }
    }
  }
}' --jq "$state_projection" 2>>"${slot}/watch-fetch.log"
}

# behind_by needs its own call — see watch_wake_rebase for why no field on the
# PR carries it. The loop makes it only when the head/base pair moved, so the
# steady state stays one request per iteration.
watch_fetch_behind_count() {
    local repo="$1" base_branch="$2" head_sha="$3" slot="$4"
    gh api "repos/${repo}/compare/${base_branch}...${head_sha}" --jq '.behind_by' 2>>"${slot}/watch-fetch.log"
}
