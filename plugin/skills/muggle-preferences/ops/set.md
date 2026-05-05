# Set — direct (key + value)

Trigger: user names both key and value (e.g. "set autoLogin to always", "make showElectronBrowser never for this project").

1. Parse `key` and `value`.
2. Verify `preference-gates/<key>.md` exists. If not, list `preference-gates/*.md` and ask.
3. Validate `value` per Shared context.
4. Resolve scope per Shared context.
5. `muggle-local-preferences-set`.
6. Confirm: `Set {key} to {value} ({scope}).`
