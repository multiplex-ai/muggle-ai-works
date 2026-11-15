#!/usr/bin/env bash
# Copy the subscription login resolve-codex-auth wrote into each Codex home
# given. A no-op under API-key auth, where CODEX_API_KEY reaches every session.
set -euo pipefail
[ -n "${CODEX_AUTH_FILE:-}" ] || exit 0
# mkdir/cp/chmod rather than `install -D`, which BSD install (macOS) rejects.
for codex_home in "$@"; do
  mkdir -p "$codex_home"
  cp "$CODEX_AUTH_FILE" "$codex_home/auth.json"
  chmod 600 "$codex_home/auth.json"
done
