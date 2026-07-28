# Refresh the PR title or body

For `open-prs/update.md` when E2E state flips (passing↔failing) or validation strategy changes.

```bash
gh pr edit <pr-number> --repo <owner>/<repo> --title "<new-title>"
gh pr edit <pr-number> --repo <owner>/<repo> --body-file <file>
```

The `<file>` body must end with the Muggle Works signature. Because the description is re-posted on each refresh, strip the old signature (from the `<!-- muggle-works:signature -->` marker to the end) before re-appending it — see [`../post-signature.md`](../post-signature.md).
