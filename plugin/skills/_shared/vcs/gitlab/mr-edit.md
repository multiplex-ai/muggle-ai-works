# Refresh the MR title or description

For `open-prs/update.md` when E2E state flips (passing↔failing) or validation strategy changes. GitLab calls the body the **description**.

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/sign-body.sh" --command /muggle-do --mode editable < <draft-file> > <signed-file>
glab mr update <iid> -R <group>/<project> --title "<new-title>"
glab mr update <iid> -R <group>/<project> --description "$(cat <signed-file>)"
```

Sign with `--mode editable` per [`../post-signature.md`](../post-signature.md) — a description is re-posted on every refresh, and that mode cuts the previous signature before appending so they never stack.
