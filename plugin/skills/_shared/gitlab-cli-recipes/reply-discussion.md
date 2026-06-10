# Reply to a discussion (threaded)

Used by `/muggle-do` per-comment inline replies. A threaded reply is a new note appended to an existing discussion.

```bash
glab api --method POST \
  projects/:id/merge_requests/:iid/discussions/<discussion-id>/notes \
  -f body="<reply-text>"
```
