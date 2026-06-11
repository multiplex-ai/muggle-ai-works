# Open a merge request

For `open-prs`. Push the branch first (see [`../github-cli-recipes/push-to-branch.md`](../github-cli-recipes/push-to-branch.md)), then open the MR.

```bash
glab mr create -R <group>/<project> \
  --source-branch <branch> --target-branch <base> \
  --title "<title>" --description "$(cat <file>)"
```

`glab` prints the created MR's URL on success — capture stdout and store the URL for handoff (the watcher seeds from it, the user gets the link).
