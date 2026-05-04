# Change one — `/muggle-preferences <key>`

1. Verify `preference-gates/<key>.md` exists. If not, list `preference-gates/*.md` and ask.
2. Read it. Run **Picker 1** with **three options**: the gate's two options (mapped to `always`/`never`) plus `Ask me each time` (sub: `Prompt me at decision time.`) → `ask`.
3. `muggle-local-preferences-set` with the mapped value, `scope: "global"`.
4. Confirm: `Set <key> to <value>.`

Skip Picker 2 — user explicitly asked to change.

**Gates whose Picker 1 isn't a static yes/no** (e.g. `autoSelectProject`, where the picker is the project list rendered by the calling skill): present a generic 3-option picker using the gate's silent-action wording for the `always`/`never` labels, plus `Ask me each time` → `ask`.
