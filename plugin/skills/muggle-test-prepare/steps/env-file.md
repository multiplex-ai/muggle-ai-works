# Environment file sanity

The env file is **per-repo** — don't hardcode `.env.local`. Detect by scanning `package.json` `scripts/*` for `.env*` literals and known port vars (`PORT=`, `VITE_PORT=`); check framework config (`next.config.*`, `vite.config.*`).

When a dependency on an env file exists, for each service's run directory ([resolve-sources](./resolve-sources.md)):

1. Check `<run-dir>/<envfile>` exists — if yes, no-op.
2. If absent and the repo's main working tree has it at the same sub-directory, copy it — notify, don't ask: it is the user's own config for this repo, and a fresh worktree or base checkout never carries one.

   > "Copied `<envfile>` into `<run-dir>` from the main working tree."

3. Otherwise `git worktree list --porcelain` and check each sibling for the same filename. If found:

   > "`<envfile>` is missing in this worktree but exists at `<sibling>/<envfile>`. Copy it before starting services?"

   - Option 1: "Yes — copy from `<sibling>`"
   - Option 2: "No — I'll provide it another way"

4. If not found anywhere, report and ask.

Never overwrite an env file that exists. Skip silently when no env file is referenced.
