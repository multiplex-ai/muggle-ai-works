# Identify the loop user

The GitHub identity that owns the authenticated `gh` token. Resolve-reminder thread classification and reply attribution need this.

```bash
gh api user --jq '.login'
```

Cache in `state.md` under `Loop user:`; re-resolve only when missing.
