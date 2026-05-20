# Reply to a line comment (threaded)

Used by `/muggle-do` per-comment inline replies.

```bash
gh api --method POST \
  -H "Accept: application/vnd.github+json" \
  repos/<owner>/<repo>/pulls/<n>/comments/<comment-id>/replies \
  -f body="<reply-text>"
```
