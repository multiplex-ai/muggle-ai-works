# Step 4.5: Environment File Sanity

The env file is **per-repo** — don't hardcode `.env.local`. Detect by scanning `package.json` `scripts/*` for `.env*` literals and known port vars (`PORT=`, `VITE_PORT=`); check framework config (`next.config.*`, `vite.config.*`).

When a dependency on an env file exists:

1. Check `<cwd>/<envfile>` exists — if yes, no-op.
2. If absent, `git worktree list --porcelain` and check each sibling for the same filename.
3. If found:

   > "`<envfile>` is missing in this worktree but exists at `<sibling>/<envfile>`. Copy it before starting services?"

   - Option 1: "Yes — copy from `<sibling>`"
   - Option 2: "No — I'll provide it another way"

4. If not found anywhere, report and ask.

Skip silently when no env file is referenced.
