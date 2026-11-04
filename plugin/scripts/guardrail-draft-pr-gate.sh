#!/usr/bin/env bash
set -uo pipefail

# Draft-PR gate (PreToolUse, Bash). Denies opening a PR/MR as a draft — `gh pr create
# --draft`, `glab mr create --draft|--wip`, a GitLab `Draft:` title — and turning an open
# one back into a draft (`gh pr ready --undo`, `convertPullRequestToDraft`). Muggle opens
# every PR ready for review.
#
# Must stay synchronous — only a sync PreToolUse hook can deny — and it fires before every
# Bash call, so a keyword pre-filter on the command keeps Node off the hot path. The filter
# is deliberately looser than the gate (any `draft`/`wip`/`--undo`/` -d` next to gh or glab);
# guardrails.mjs makes the exact call. Degrades to {} so it never blocks an unrelated command.

guardrail_script_dir="${BASH_SOURCE[0]%/*}"
[[ $guardrail_script_dir == "${BASH_SOURCE[0]}" ]] && guardrail_script_dir=.
. "$guardrail_script_dir/guardrail-lib.sh"

GUARDRAIL_SUBCOMMAND="draft-pr-gate"

guardrail_wants() {
  guardrail_fields_match command '(gh|glab)[[:space:]].*(draft|wip|--undo|[[:space:]]-d([[:space:]]|$))'
}

if guardrail_is_hook_script; then
  guardrail_run_standalone "$GUARDRAIL_SUBCOMMAND"
fi
