#!/usr/bin/env bash
set -uo pipefail

# tests-green-or-PR-opened → E2E gate (Stop). When unit tests passed this
# session or a PR was opened, and no E2E acceptance run has happened, offer to
# run change-driven E2E (gated by autoE2ETest). Fires once per session.
#
# This must stay synchronous (only a sync Stop hook can block the turn end), and
# it fires on EVERY turn end. There is no command payload to key off, so the
# pre-filter reads the same per-session state file guardrails.mjs uses and only
# spawns Node when the gate could actually fire — i.e. shouldRunE2E's two
# triggers, with no E2E run recorded yet. It must track that predicate exactly:
# a pre-filter narrower than the gate retires the gate silently. On the
# overwhelming majority of turns (no test run, no PR) the state file is absent,
# or unitTestsGreen is unset while prsHandled is empty, so we return {} in-shell
# and never pay Node cold-start. Degrades to {}.

guardrail_script_dir="${BASH_SOURCE[0]%/*}"
[[ $guardrail_script_dir == "${BASH_SOURCE[0]}" ]] && guardrail_script_dir=.
. "$guardrail_script_dir/guardrail-lib.sh"

GUARDRAIL_SUBCOMMAND="e2e-gate"

guardrail_wants() {
  guardrail_load_state \
    && { guardrail_state_has '"unitTestsGreen": true' || ! guardrail_state_has '"prsHandled": []'; } \
    && ! guardrail_state_has '"e2eReleased": true' \
    && ! guardrail_state_has '"e2eRun": true'
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  guardrail_run_standalone "$GUARDRAIL_SUBCOMMAND"
fi
