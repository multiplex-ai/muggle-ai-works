# Top-level PR comment

For the resolve-reminder stage and any non-threaded notice.

```bash
body="$(bash "${CLAUDE_PLUGIN_ROOT}/scripts/sign-body.sh" --command <command> --mode <mode> < <draft-file>)"
gh pr comment <pr-number> --repo <owner>/<repo> --body "$body"
```

Sign per [`../post-signature.md`](../post-signature.md). A resolve-reminder takes `--mode loop`, so the loop recognises the reminder as its own on a later tick; a one-shot notice nothing needs to detect takes `--mode plain`.
