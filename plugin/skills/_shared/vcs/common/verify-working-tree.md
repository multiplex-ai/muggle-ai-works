# Verify the working tree matches the PR

Bootstrap's environment check.

```bash
git rev-parse --show-toplevel        # cwd is a git working tree
git remote get-url origin            # remote matches <owner>/<repo>
git rev-parse --abbrev-ref HEAD      # current branch matches PR's headRefName
```

Accept any remote URL form for `<owner>/<repo>`, with or without trailing `.git`, where `<host>` is the provider host (`github.com`, or the GitLab instance host):

- `https://<host>/<owner>/<repo>`
- `git@<host>:<owner>/<repo>`
- `ssh://git@<host>/<owner>/<repo>`

Any mismatch → abort; the calling skill reports the wrong checkout to the user with its own message.
