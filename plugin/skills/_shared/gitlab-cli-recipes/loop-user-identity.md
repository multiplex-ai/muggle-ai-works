# Identify the loop user

The GitLab identity that owns the authenticated `glab` token. Resolve-reminder thread classification and reply attribution need this.

```bash
glab api user --jq '.username'
```

Cache in `state.md` under `Loop user:`; re-resolve only when missing.
