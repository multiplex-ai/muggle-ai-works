# Resolve-reminder top-level PR comment

Posted via `gh pr comment` once per review round, when at least one unresolved thread is addressed-by-loop with no newer human reply.

```
These threads are addressed and still open — mark them resolved if satisfied, or reply if more is needed:
- #<thread-id-1>
- #<thread-id-2>
- ...
```

If no such thread exists, no comment is posted (silent). Sign with `--mode loop` ([`../../_shared/vcs/post-signature.md`](../../_shared/vcs/post-signature.md)) — the marker it appends keeps the loop from later mistaking its own reminder for a human comment.
