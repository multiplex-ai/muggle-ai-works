# PR post signature

Every pull-request / merge-request body, comment, and review-thread reply that muggle works posts ends with a signature line. Under a single-account workflow the automation posts as the repo owner, so the signature is what tells a reader — and a reviewer — that the post came from Muggle Works and which command produced it.

## The line

Append this as the last line of the posted body:

```
🤖 _Posted by `<command>` · [Muggle Works](https://github.com/multiplex-ai/muggle-ai-works)_
```

`<command>` is the slash-command of the skill whose `gh` / `glab` call posts the body:

- `/muggle-do` — PR/MR descriptions, per-comment thread replies, top-level reference replies, and resolve-reminders.
- `/muggle-pr-visual-walkthrough` — a walkthrough comment the walkthrough skill posts itself (Mode A).

Name the command that owns the post, not the one that generated the content. When the walkthrough hands its rendered block back for embedding (Mode B/C), the caller owns the post, so the caller's command is what the signature names.

## Editable bodies (PR / MR description)

A description is re-posted whenever state changes, so its signature must not stack. Precede the line with a hidden marker and treat the pair as one unit:

```
<!-- muggle-works:signature -->
🤖 _Posted by `/muggle-do` · [Muggle Works](https://github.com/multiplex-ai/muggle-ai-works)_
```

Before writing an edited body, delete everything from the `<!-- muggle-works:signature -->` marker to the end of the body, then append the block fresh. This keeps exactly one signature no matter how many times the description is refreshed.

A comment or reply is posted once and never edited, so it needs no dedup marker — append the line alone. A loop-authored reply already carries the `<!-- muggle-do:bot -->` detection marker (defined in loop-signature.md) directly above this line; that marker stays, and this line replaces the old visible text.
