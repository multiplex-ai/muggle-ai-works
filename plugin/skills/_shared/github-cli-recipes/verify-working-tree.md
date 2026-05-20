# Verify the working tree matches the PR

Bootstrap's environment check.

```bash
git rev-parse --show-toplevel        # cwd is a git working tree
git remote get-url origin            # remote matches <owner>/<repo>
git rev-parse --abbrev-ref HEAD      # current branch matches PR's headRefName
```

Accept any remote URL form for `<owner>/<repo>` (with or without trailing `.git`):

- `https://github.com/<owner>/<repo>`
- `git@github.com:<owner>/<repo>`
- `ssh://git@github.com/<owner>/<repo>`

Any mismatch → bootstrap aborts using the wrong-checkout template in [`../../muggle-pr-followup/output-templates/bootstrap.md`](../../muggle-pr-followup/output-templates/bootstrap.md).
