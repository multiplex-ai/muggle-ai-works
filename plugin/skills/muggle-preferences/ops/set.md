# Set — direct (key + value)

Trigger: user names both key and value (e.g. "set autoLogin to always", "make showElectronBrowser never").

1. Parse `key` and `value`.
2. Verify `preference-gates/<key>.md` exists. If not, list `preference-gates/*.md` and ask.
3. Validate `value` per Shared context.
4. `muggle-local-preferences-set`.
5. Confirm: `Set {key} to {value}.`
