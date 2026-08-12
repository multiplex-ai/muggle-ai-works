# Open a merge request

For `open-prs`. Push the branch first (see [`../common/push-to-branch.md`](../common/push-to-branch.md)), then open the MR.

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/sign-body.sh" --command /muggle-do --mode editable < <draft-file> > <signed-file>
glab mr create -R <group>/<project> \
  --source-branch <branch> --target-branch <base> \
  --title "<title>" --description "$(cat <signed-file>)"
```

Sign with `--mode editable` per [`../post-signature.md`](../post-signature.md) — the description this opens the MR with is the same body `mr-edit.md` refreshes later, so it carries the dedup marker from the start.

`glab` prints the created MR's URL on success — capture stdout and store the URL for handoff (the watcher seeds from it, the user gets the link).
