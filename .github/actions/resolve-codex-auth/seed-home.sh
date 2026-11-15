#!/usr/bin/env bash
# Copy the subscription login resolve-codex-auth wrote into each Codex home
# given. A no-op under API-key auth, where CODEX_API_KEY reaches every session.
set -euo pipefail
[ -n "${CODEX_AUTH_FILE:-}" ] || exit 0
for codex_home in "$@"; do
  install -D -m 600 "$CODEX_AUTH_FILE" "$codex_home/auth.json"
done
