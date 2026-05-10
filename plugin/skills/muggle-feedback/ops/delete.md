# Delete feedback

Soft-delete a feedback entry. Always confirm with the user before deleting — this is a write the user cannot undo from this skill.

## 1. Identify the feedback

Three paths:

- **Explicit id** — user named the feedback id (e.g. "delete feedback `abcd-1234-...`"). Use it.
- **Recently shown id** — the user is referring to a row from a list rendered earlier in the conversation. Resolve from that context.
- **No id given** — run [`list.md`](list.md) first to surface entries; offer "Delete one" as the next-action; the user picks.

## 2. Show what will be deleted

Print:

```
Feedback: <id>
Target:   <Whole script | Step N>
Test case: <title>
Created:  <human-readable>
Text:
  <full feedbackText, indented>
```

## 3. Confirm

`AskUserQuestion`:

> "Delete this feedback?"
> - **Delete** — proceed
> - **Cancel** — abort

If the user cancels, print "Cancelled — feedback kept." and stop.

## 4. Soft-delete

`muggle-remote-user-feedback-delete` with the feedback id.

## 5. Report

On success: `✓ Deleted feedback <id>.`

On failure: print the error verbatim. If the error is "not found", inform the user the entry was likely already deleted and continue gracefully.

## Non-negotiables

- Never delete without an explicit confirm step, even if the user said "delete X" in their original prompt — the confirm shows what they're actually deleting.
- One delete call per invocation. No bulk delete in v1.
