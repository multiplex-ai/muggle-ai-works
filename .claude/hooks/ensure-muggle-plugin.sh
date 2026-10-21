#!/usr/bin/env bash

set -euo pipefail

# Best-effort install of the muggle plugin for a session that has none — a contributor's first
# session, or an ephemeral environment (e.g. Claude web) where ~/.claude/plugins/ does not persist.
#
# A contributor who already has the plugin keeps the version they installed. That is why the repo's
# settings declare no marketplace source: Claude Code re-registers a declared source over the user's
# own on every trusted session, which would swap an npm-installed plugin for this repo's default
# branch. The install below declares the marketplace at user scope — the one declaration the npm
# postinstall repoints when the user later installs @muggleai/works globally.

readonly MARKETPLACE_NAME="muggle-works"
readonly PLUGIN_SPEC="muggleai@${MARKETPLACE_NAME}"
readonly MARKETPLACE_REPO="multiplex-ai/muggle-ai-works"

if ! command -v claude >/dev/null 2>&1; then
  exit 0
fi

if claude plugin list 2>/dev/null | grep -Fq "${PLUGIN_SPEC}"; then
  exit 0
fi

claude plugin marketplace add "${MARKETPLACE_REPO}" --scope user >/dev/null 2>&1 || true
claude plugin install "${PLUGIN_SPEC}" --scope user >/dev/null 2>&1 || true
