# Resolve-reminder top-level PR comment

Posted via `gh pr comment` after the resolve-reminder stage scans threads. Only when at least one addressed-by-loop thread exists.

```
I addressed these threads in <short-sha> — mark them resolved when satisfied:
- #<thread-id-1>
- #<thread-id-2>
- ...
```

If `addressed_by_loop == 0`, no comment is posted (silent).
