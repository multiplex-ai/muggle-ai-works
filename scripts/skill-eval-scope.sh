#!/usr/bin/env bash
set -uo pipefail

# Decides how much of the gate suite a pull request owes. Reads the changed
# paths on stdin and prints exactly one line:
#
#   full            — run every gate
#   scoped a,b      — run only these skills' gates
#   skip            — no gate can change its verdict on this diff
#
# Lives here rather than inline in the workflow so the rule can be unit-tested
# without building a throwaway git repository per case.
#
# What can actually change a gate's verdict is narrow, and pinned by
# internal/skill-gate-eval/test/system-prompt.test.ts: a gate prompt is built
# from the skill's SKILL.md plus the gate contract, and the harness denies the
# Read tool, so a skill under eval cannot open any other file. A support file
# under a skill directory is therefore invisible to every gate — running the
# whole suite for one is cost without signal. If that test ever fails, this
# rule has to widen with it.
#
# The SKILL.md inspection needs the diff itself; `git diff` is reached through
# a seam so a test can feed canned hunks.

base="${1:?usage: skill-eval-scope.sh <base-ref> < changed-paths}"

diff_lines() {
  if [ -n "${SKILL_EVAL_DIFF_CMD:-}" ]; then
    "$SKILL_EVAL_DIFF_CMD" "$1"
    return
  fi
  git diff -U0 "$base...HEAD" -- "$1" | grep -E '^[+-]' | grep -vE '^(\+\+\+|---) '
}

changed="$(cat)"

paths_matching() {
  printf '%s\n' "$changed" | grep -E "$1" || true
}

# The eval's own harness, and the gate contracts inlined into every prompt.
if [ -n "$(paths_matching '^internal/skill-gate-eval/')" ] \
  || [ -n "$(paths_matching '^plugin/skills/muggle-preferences/preference-gates/')" ]; then
  printf 'full\n'
  exit 0
fi

scoped=""
for skill_md in $(paths_matching '^plugin/skills/[^/]+/SKILL\.md$' | sort -u); do
  skill="$(printf '%s' "$skill_md" | awk -F/ '{print $3}')"
  lines="$(diff_lines "$skill_md")"
  [ -z "$lines" ] && continue
  # A gate reads the whole SKILL.md, so any body line forces the full suite;
  # only the `model:` line is narrow enough to scope to its own skill.
  if printf '%s\n' "$lines" | grep -qvE '^[+-]model:[[:space:]]'; then
    printf 'full\n'
    exit 0
  fi
  scoped="${scoped:+$scoped,}$skill"
done

if [ -n "$scoped" ]; then
  printf 'scoped %s\n' "$scoped"
  exit 0
fi

printf 'skip\n'
