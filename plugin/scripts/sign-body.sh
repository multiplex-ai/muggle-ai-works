#!/usr/bin/env bash
#
# Appends the Muggle Works signature to a body about to be posted to a PR/MR.
#
# Reads the unsigned body on stdin, writes the signed body on stdout:
#
#   sign-body.sh --command /muggle-do --mode loop < draft.md
#
# --command  slash-command of the skill whose post this is (owner of the post,
#            not the producer of the content).
# --mode     loop      thread replies and resolve-reminders: prefixes the
#                      <!-- muggle-do:bot --> echo-detection marker.
#            editable  PR/MR descriptions: prefixes the dedup marker, and cuts
#                      any previous signature so refreshes never stack.
#            plain     one-shot comments with no marker.
#
# Idempotent: an already-signed body is re-signed, not double-signed.

set -euo pipefail

readonly REPOSITORY_URL='https://github.com/multiplex-ai/muggle-ai-works'
readonly SIGNATURE_PREFIX='🤖 _Posted by '
readonly LOOP_MARKER='<!-- muggle-do:bot -->'
readonly EDITABLE_MARKER='<!-- muggle-works:signature -->'

usage() {
  echo "usage: sign-body.sh --command <slash-command> --mode <loop|editable|plain>" >&2
  exit 2
}

postedCommand=''
signatureMode=''

while [ $# -gt 0 ]; do
  case "$1" in
    --command) postedCommand="${2-}"; shift 2 ;;
    --mode) signatureMode="${2-}"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "sign-body.sh: unknown argument '$1'" >&2; usage ;;
  esac
done

[ -n "$postedCommand" ] || usage
case "$signatureMode" in
  loop|editable|plain) ;;
  *) usage ;;
esac

# Cuts any signature the body already carries, so re-signing an edited body
# replaces it instead of stacking a second one underneath.
stripExistingSignature() {
  awk -v editableMarker="$EDITABLE_MARKER" \
      -v loopMarker="$LOOP_MARKER" \
      -v signaturePrefix="$SIGNATURE_PREFIX" '
    { lines[NR] = $0 }
    END {
      cut = NR + 1
      for (i = 1; i <= NR; i++) {
        if (lines[i] == editableMarker) { cut = i; break }
      }
      if (cut == NR + 1) {
        for (i = NR; i >= 1; i--) {
          if (lines[i] == "") continue
          if (index(lines[i], signaturePrefix) == 1) {
            cut = i
            if (i > 1 && (lines[i - 1] == loopMarker || lines[i - 1] == editableMarker)) cut = i - 1
          }
          break
        }
      }
      last = cut - 1
      while (last >= 1 && lines[last] == "") last--
      for (i = 1; i <= last; i++) print lines[i]
    }
  '
}

body="$(stripExistingSignature)"

case "$signatureMode" in
  loop) marker="$LOOP_MARKER" ;;
  editable) marker="$EDITABLE_MARKER" ;;
  plain) marker='' ;;
esac

printf '%s\n\n' "$body"
[ -z "$marker" ] || printf '%s\n' "$marker"
printf '%s`%s` · [Muggle Works](%s)_\n' "$SIGNATURE_PREFIX" "$postedCommand" "$REPOSITORY_URL"
