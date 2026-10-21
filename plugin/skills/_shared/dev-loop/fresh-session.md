# Dev Loop — Fresh Session

## Generation

The test case stores whether every run starts from an empty browser session (`alwaysStartsFreshSession`, from `muggle-remote-test-case-get`). Omit `freshSession` on `muggle-local-execute-test-generation` and the stored value decides.

Pass `freshSession` only to override the stored value for one run: `true` forces a clean session, `false` keeps the existing one. The value the run uses is recorded with its script, so a replay of that script starts the same way.

For an older test case with no stored flag, pass `freshSession: true` when it needs clean browser state (no prior cookies, localStorage, or login), as these do, and omit it otherwise:

- Registration / sign-up.
- Login / authentication when the flow itself is under test (not a test that merely uses login as a prerequisite).
- Cookie-consent / GDPR first-visit banners.
- Onboarding / first-run experiences.

## Replay

Replay runs as the script was recorded, never as the test case is now. Copy `pinnedAccount` and `freshSession` from the `actionParams` of the `muggle-remote-action-script-get` result onto `muggle-local-execute-replay` when present. A recording that carries neither may predate run identities, so decide its `freshSession` by the list above, as before.

## Changing the stored value

Use `muggle-remote-test-case-update` with `alwaysStartsFreshSession`. It applies from the next generation; an existing script replays the way it was recorded.
