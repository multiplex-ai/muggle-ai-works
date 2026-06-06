# Bootstrap output templates

## Success summary (printed just before dispatch)

```
Bootstrapped PR follow-up for <owner>/<repo>#<n>
  Slug:           <slug>
  Baseline:       thread-state (unresolved threads picked up live); lastBodyReviewId=0 | =<id> (forward-only)
  Working tree:   <toplevel>
  Dispatching:    /loop 1m /muggle:muggle-pr-followup <slug> <n>
```

## Aborts

**Terminal PR:**
```
PR <owner>/<repo>#<n> is <state>; nothing to poll. Bootstrap aborted.
```

**Wrong working tree / wrong branch:**
```
Bootstrap needs the PR's branch checked out locally.
Current cwd:    <toplevel-or-"not in a git repo">
Current branch: <HEAD-or-"n/a">
Expected:       a clone of <owner>/<repo> on branch <headRefName>.
From that clone, run: gh pr checkout <n>
```

**Slot conflict (no `--resume`):**
```
Session <slug> already exists at <path>.
To reuse it, pass --resume on this invocation.
To start fresh, rm -rf the directory and re-run.
```

**Malformed URL:**
```
Could not parse <input> as a GitHub PR URL.
Expected: https://github.com/<owner>/<repo>/pull/<number>
```

**GitHub API failure (PR not found, no auth, etc.):** repeat the underlying `gh` error verbatim. Do not paraphrase.
