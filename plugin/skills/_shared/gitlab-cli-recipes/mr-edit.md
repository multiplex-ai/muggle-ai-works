# Refresh the MR title or description

For `open-prs/update.md` when E2E state flips (passing↔failing) or validation strategy changes. GitLab calls the body the **description**.

```bash
glab mr update <iid> -R <group>/<project> --title "<new-title>"
glab mr update <iid> -R <group>/<project> --description "$(cat <file>)"
```
