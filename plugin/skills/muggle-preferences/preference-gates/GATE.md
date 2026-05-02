# Preference Gate Runner

Given `key` and caller-defined outcomes **pro-action** and **skip-action**:

1. Read `key`'s current value from session context (`Muggle Preferences key=value …`). Default: `ask`.
2. Read `preference-gates/<key>.md` to get Picker 1 spec, silent action wording, and any Picker 2 override.
3. Resolve:
   - `always` → take pro-action; print silent footer.
   - `never` → take skip-action; print silent footer.
   - `ask` → run Picker 1 from the key file. Then run Picker 2 (README.md shared template, unless the key file overrides). On "Yes, always" → `muggle-local-preferences-set` with the mapped value, `scope: "global"`.

**Silent footer:**
```
✓ <silent action from key file>
  (Skipped the prompt — `<key>` is set to `<value>`. Change: `/muggle-preferences <key>`.)
```

`defaultExecutionMode` uses `local`/`remote`/`ask` — treat `local`/`remote` as `always`/`never` (same silent-footer logic, no Picker 2 when fired silently).
