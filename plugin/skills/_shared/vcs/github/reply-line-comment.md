# Reply to a line comment (threaded)

Used by `/muggle-do` per-comment inline replies.

```bash
gh api --method POST \
  -H "Accept: application/vnd.github+json" \
  repos/<owner>/<repo>/pulls/<n>/comments/<comment-id>/replies \
  -f body="<reply-text>"
```

The `<reply-text>` must end with the loop signature block — the `<!-- muggle-do:bot -->` detection marker above the Muggle Works line. See [`../post-signature.md`](../post-signature.md).
