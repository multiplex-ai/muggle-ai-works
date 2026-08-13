# Reply to a line comment (threaded)

Used by `/muggle-do` per-comment inline replies.

```bash
body="$(bash "${CLAUDE_PLUGIN_ROOT}/scripts/sign-body.sh" --command /muggle-do --mode loop < <draft-file>)"
gh api --method POST \
  -H "Accept: application/vnd.github+json" \
  repos/<owner>/<repo>/pulls/<n>/comments/<comment-id>/replies \
  -f body="$body"
```

Sign with `--mode loop` per [`../post-signature.md`](../post-signature.md) — the `<!-- muggle-do:bot -->` marker it prefixes is what keeps the loop from re-triggering on its own reply.
