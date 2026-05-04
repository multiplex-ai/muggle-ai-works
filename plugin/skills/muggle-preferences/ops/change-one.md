# Change one — `/muggle-preferences <key>`

1. Verify `preference-gates/<key>.md` exists. If not, list `preference-gates/*.md` and ask.
2. Read it; run **Picker 1 only** per its spec.
3. `muggle-local-preferences-set` with the mapped value, `scope: "global"`.
4. Confirm: `Set <key> to <value>.`

Skip Picker 2 — user explicitly asked to change.
