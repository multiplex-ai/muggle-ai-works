# Resolve a discussion thread

Mark a thread resolved once the loop's reply has addressed it — the resolve-reminder stage's action.

```bash
glab api --method PUT \
  "projects/:id/merge_requests/:iid/discussions/<discussion-id>?resolved=true"
```

Resolves every resolvable note in the thread at once. Only resolvable (diff/line) threads accept this; a non-resolvable discussion returns an error.
