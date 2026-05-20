# `muggle-do:resolve-reminder`

Zero or one per cycle. Fires after the resolve-reminder stage scans threads — only when actionables ran.

```json
{
  "skill": "muggle-do",
  "event": "resolve-reminder",
  "session_slug": "<slug>",
  "repo": "<owner>/<repo>",
  "pr_number": <int>,
  "addressed_by_loop": <int>,
  "addressed_by_human": <int>,
  "not_addressed": <int>,
  "comment_posted": true | false
}
```

- `comment_posted`: false when there were zero addressed-by-loop threads; telemetry still emits so dashboards see the scan happened.
