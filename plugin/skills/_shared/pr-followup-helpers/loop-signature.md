# Loop comment signature

Every comment `/muggle-do` posts on either provider — inline thread replies (`gitlab`: discussion notes), top-level reference comments, resolve-reminders — **must** carry the loop marker. It is the only reliable way to tell loop-authored comments from human comments: in single-account workflows the loop posts under the change author's own identity, so the author login cannot distinguish them. Echo-protection and addressed-by-loop classification both depend on this marker.

## The marker

```
<!-- muggle-do:bot -->
```

Hidden HTML: both providers render it invisibly and humans never type it. It must stay exactly as written — echo-protection and addressed-by-loop classification read this literal string.

Signing a body with `--mode loop` ([`../vcs/post-signature.md`](../vcs/post-signature.md)) emits the marker above the visible Muggle Works line. Never hand-write either one; a body assembled by hand is the one that silently ships without them.

## Detection

- **Loop-authored** — the comment body contains the literal `<!-- muggle-do:bot -->`.
- **Human** — the body does not contain the marker.

Classify by the marker, never by the author login alone (`github`: `author.login`, `gitlab`: `author.username`) — the login is ambiguous under a shared account. A comment that carries the marker is the loop's own and must never re-trigger a cycle; a comment without it is human intent to act on.
