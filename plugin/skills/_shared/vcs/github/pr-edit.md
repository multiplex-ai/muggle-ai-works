# Refresh the PR title or body

For `open-prs/update.md` when E2E state flips (passing↔failing) or validation strategy changes.

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/sign-body.sh" --command /muggle-do --mode editable < <draft-file> > <signed-file>
gh pr edit <pr-number> --repo <owner>/<repo> --title "<new-title>"
gh pr edit <pr-number> --repo <owner>/<repo> --body-file <signed-file>
```

Sign with `--mode editable` per [`../post-signature.md`](../post-signature.md) — a description is re-posted on every refresh, and that mode cuts the previous signature before appending so they never stack.
