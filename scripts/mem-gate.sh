#!/usr/bin/env bash
# Runs a command under peak-RSS measurement and reports it, so a memory
# regression in the evals/tests surfaces before it OOMs a CI runner. Report-only
# by default; set a budget to turn it into a gate once baselines are known.
#
# Usage:  scripts/mem-gate.sh <command> [args...]
# Env:
#   MEM_BUDGET_KB       peak-RSS budget in KB. Unset (default) → report only.
#   MEM_GATE_BLOCKING   "1" → fail the step when peak RSS exceeds MEM_BUDGET_KB.
#                       Anything else → over-budget is a ::warning:: only.
#
# Peak RSS comes from GNU `/usr/bin/time -v` (present on the ubuntu runners).
# Where it is unavailable the command still runs — the gate degrades to a no-op
# rather than breaking the build.
set -uo pipefail

if [ "$#" -eq 0 ]; then
  echo "mem-gate: no command given" >&2
  exit 2
fi

if command -v /usr/bin/time >/dev/null 2>&1 && /usr/bin/time -v true >/dev/null 2>&1; then
  timelog=$(mktemp)
  /usr/bin/time -v -o "$timelog" "$@"
  status=$?
  peak_kb=$(awk -F': ' '/Maximum resident set size/ { gsub(/[^0-9]/, "", $2); print $2 }' "$timelog")
  rm -f "$timelog"
else
  echo "mem-gate: GNU '/usr/bin/time -v' unavailable — running without memory measurement" >&2
  "$@"
  status=$?
  peak_kb=""
fi

if [ -z "$peak_kb" ]; then
  exit "$status"
fi

peak_mb=$(( peak_kb / 1024 ))
report="mem-gate: peak RSS ${peak_mb} MB (${peak_kb} KB) — ${*}"
echo "$report"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  echo "- ${report}" >> "$GITHUB_STEP_SUMMARY"
fi

if [ -n "${MEM_BUDGET_KB:-}" ] && [ "$peak_kb" -gt "$MEM_BUDGET_KB" ]; then
  over="peak RSS ${peak_kb} KB exceeds budget ${MEM_BUDGET_KB} KB"
  if [ "${MEM_GATE_BLOCKING:-}" = "1" ]; then
    echo "::error::mem-gate: ${over}"
    exit 1
  fi
  echo "::warning::mem-gate: ${over} (report-only; set MEM_GATE_BLOCKING=1 to enforce)"
fi

exit "$status"
