# Reply to a discussion (threaded)

Used by `/muggle-do` per-comment inline replies. A threaded reply is a new note appended to an existing discussion.

```bash
body="$(bash "${CLAUDE_PLUGIN_ROOT}/scripts/sign-body.sh" --command /muggle-do --mode loop < <draft-file>)"
glab api --method POST \
  projects/:id/merge_requests/<iid>/discussions/<discussion-id>/notes \
  -f body="$body"
```

Sign with `--mode loop` per [`../post-signature.md`](../post-signature.md) — the `<!-- muggle-do:bot -->` marker it prefixes is what keeps the loop from re-triggering on its own note.
