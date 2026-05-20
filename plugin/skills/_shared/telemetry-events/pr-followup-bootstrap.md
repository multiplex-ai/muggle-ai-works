# `muggle-pr-followup:bootstrap`

One per successful bootstrap, after state seeding and before the first watcher dispatches.

```json
{
  "skill": "muggle-pr-followup",
  "event": "bootstrap",
  "caller": "<caller-name>",
  "session_slug": "<slug>",
  "repo": "<owner>/<repo>",
  "pr_number": <int>,
  "cursor_review_id": <int>,
  "resume": true | false
}
```

- `caller`: `"user"` for direct invocation; another skill name if relayed.
- `cursor_review_id`: `0` if no prior submitted reviews; otherwise the highest existing review id.
- `resume`: true when `--resume` was used.
