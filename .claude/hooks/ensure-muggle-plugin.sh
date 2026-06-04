#!/usr/bin/env bash

set -euo pipefail

# Best-effort install of the muggle-ai-works marketplace plugin at project scope.
# Used for ephemeral environments (e.g. Claude web) where ~/.claude/plugins/ does not persist.
# Desktop users with extraKnownMarketplaces + enabledPlugins in settings.json get the same
# plugin via trust prompts; this hook makes the first session self-contained when needed.

readonly MARKETPLACE_NAME="muggle-works"
readonly PLUGIN_SPEC="muggleai@${MARKETPLACE_NAME}"
readonly MARKETPLACE_REPO="multiplex-ai/muggle-ai-works"

if ! command -v claude >/dev/null 2>&1; then
  exit 0
fi

if claude plugin list 2>/dev/null | grep -Fq "${PLUGIN_SPEC}"; then
  exit 0
fi

claude plugin marketplace add "${MARKETPLACE_REPO}" --scope project >/dev/null 2>&1 || true
claude plugin install "${PLUGIN_SPEC}" --scope project >/dev/null 2>&1 || true
