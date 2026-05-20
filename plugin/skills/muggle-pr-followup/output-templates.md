# User-Facing Output Templates

All terminal messages, summary lines, and PR comment text the watcher and bootstrap emit, in one place. Adjust wording here; cite from procedure files.

## Bootstrap

### Success summary (printed just before dispatch)

```
Bootstrapped PR follow-up for <owner>/<repo>#<n>
  Slug:           <slug>
  Cursor:         review #<id> (forward-only) | empty (no prior reviews)
  Working tree:   <toplevel>
  Dispatching:    /loop 1m /muggle:muggle-pr-followup <slug> <n>
```

### Aborts

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

## Watcher tick

### Idle tick (logged only, not printed)

Appended to `followup.log`:
```
<ISO-8601> tick pr=<n> reviews_seen=0 idle
```

### Dispatching tick (logged only, not printed)

Appended to `followup.log`:
```
<ISO-8601> tick pr=<n> reviews_seen=<count> dispatched=<id1>,<id2>,...
```

### Terminal tick

Appended to `followup.log`:
```
<ISO-8601> tick pr=<n> terminal=<merged|closed> result.md written
```

The watcher does **not** print anything to the user during normal operation. All user-facing escalations come from `/muggle-do`.

## `/muggle-do` address-reviews terminal messages

These templates live with `/muggle-do`'s procedure files (`do/`), but their wording is anchored here so the watcher and `/muggle-do` stay aligned.

### Ambiguous escalation

```
**Review-followup escalation — <owner>/<repo>#<n>**

I can't act on <count> review(s) without your input. Listed below; reply on GitHub by submitting a new review with clearer direction, or tell me here which way to go.

Review #<id> from <login>:
> <body or "(no body)">

Comments:
- <file>:<line> — <body>
- ...

[Repeat per ambiguous review in the batch.]
```

### Design-adjustment escalation

```
**Design-adjustment needed — <owner>/<repo>#<n>**

While addressing review #<id>, the cycle surfaced a conflict with the current design:

  <one-paragraph description of the conflict>

This is beyond a routine code change. Confirm the design intent (reply here, or update the requirements doc) before I retry.
```

### Cycle summary inline reply (per comment)

Posted via `gh api .../comments/<comment-id>/replies`.

```
Addressed in <short-sha>: <one-line summary of the change made for THIS comment>.
```

### Resolve-reminder (top-level PR comment)

Posted via `gh pr comment`. Only when at least one addressed-by-loop thread exists.

```
I addressed these threads in <short-sha> — mark them resolved when satisfied:
- #<thread-id-1>
- #<thread-id-2>
- ...
```

If `addressed_by_loop == 0`, no comment is posted (silent).

## Help output

For `/muggle:muggle-pr-followup` with no args, or with `help` / `?`:

```
muggle-pr-followup — watcher loop for PR review follow-ups

Active loops:
  <slug> → <owner>/<repo>#<n> (cursor @ review #<id>, <N> cycles)
  ...
  (or "no active loops")

Usage:
  /muggle:muggle-pr-followup <pr-url>            → bootstrap a new loop
  /muggle:muggle-pr-followup <slug> <pr-number>  → run one tick (called by /loop)
  /muggle:muggle-pr-followup <pr-number>         → run one tick (slug inferred from on-disk state)
```
