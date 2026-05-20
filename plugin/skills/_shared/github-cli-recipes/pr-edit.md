# Refresh the PR title or body

For `open-prs/update.md` when E2E state flips (passing↔failing) or validation strategy changes.

```bash
gh pr edit <pr-number> --repo <owner>/<repo> --title "<new-title>"
gh pr edit <pr-number> --repo <owner>/<repo> --body-file <file>
```
