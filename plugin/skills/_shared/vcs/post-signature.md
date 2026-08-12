# PR post signature

Every pull-request / merge-request body, comment, and review-thread reply that muggle works posts ends with a signature line. Under a single-account workflow the automation posts as the repo owner, so the signature is what tells a reader — and a reviewer — that the post came from Muggle Works and which command produced it.

## Signing a body

Pipe the body through the shipped script. Never retype the line from this doc: a signature derived from prose is dropped silently, and a post that lost it still succeeds, still looks right to the poster, and is indistinguishable from a human comment forever after.

```bash
body="$(bash "${CLAUDE_PLUGIN_ROOT}/scripts/sign-body.sh" --command <command> --mode <mode> < <draft-file>)"
```

`--mode` picks the marker that precedes the visible line:

| Mode | Marker | Use for |
|------|--------|---------|
| `loop` | `<!-- muggle-do:bot -->` | Thread replies and resolve-reminders — anything the loop must later recognise as its own. |
| `editable` | `<!-- muggle-works:signature -->` | PR/MR descriptions. The script cuts the previous signature before appending, so a description re-posted on every refresh keeps exactly one. |
| `plain` | none | One-shot comments that nothing needs to detect later. |

Signing is idempotent — an already-signed body is re-signed, not double-signed — so a body may be passed through on a refresh path without checking whether it carries a signature already.

## The line

What the script emits, recorded here so a reader can recognise it. The script is the definition:

```
🤖 _Posted by `<command>` · [Muggle Works](https://github.com/multiplex-ai/muggle-ai-works)_
```

## Naming the command

`<command>` is the slash-command of the skill whose `gh` / `glab` call posts the body:

- `/muggle-do` — PR/MR descriptions, per-comment thread replies, top-level reference replies, and resolve-reminders.
- `/muggle-pr-visual-walkthrough` — a walkthrough comment the walkthrough skill posts itself (Mode A).

Name the command that owns the post, not the one that generated the content. When the walkthrough hands its rendered block back for embedding (Mode B/C), the caller owns the post, so the caller's command is what the signature names.

## Enforcement

`scripts/check-post-signatures.mjs` fails any recipe that posts a body without signing it, on every PR via the `post-signatures` CI job and locally via `pnpm run verify:signatures`.
