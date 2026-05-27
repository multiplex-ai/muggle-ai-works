# Loop comment signature

Every GitHub comment `/muggle-do` posts — inline thread replies, top-level reference comments, resolve-reminders — **must** end with the signature block below. It is the only reliable way to tell loop-authored comments from human comments: in single-account workflows the loop posts under the PR author's own identity, so `author.login` cannot distinguish them. Echo-protection and addressed-by-loop classification both depend on this marker.

## The signature

Append these two lines as the end of every loop-posted comment body:

```
<!-- muggle-do:bot -->
🤖 _Automated reply from muggle-do._
```

- `<!-- muggle-do:bot -->` — hidden HTML marker; GitHub renders it invisibly and humans never type it. This is the **detection token**.
- The visible line makes the automation clear to a reader.

## Detection

- **Loop-authored** — the comment body contains the literal `<!-- muggle-do:bot -->`.
- **Human** — the body does not contain the marker.

Classify by the marker, never by `author.login` alone — the login is ambiguous under a shared account. A comment that carries the marker is the loop's own and must never re-trigger a cycle; a comment without it is human intent to act on.
