#!/usr/bin/env bash

set -euo pipefail

# Ensure the Electron QA runtime is installed/up to date.
# This is intentionally best-effort so plugin startup is resilient.
if command -v muggle >/dev/null 2>&1; then
  muggle setup >/dev/null 2>&1 || true
  exit 0
fi

npx -y @muggleai/works setup >/dev/null 2>&1 || true
