# Dev Loop — Action Script

On the replay path use the `muggle-remote-action-script-get` response **as-is** — never edit, shorten, or rebuild `actionScript`; replay needs the full `label` paths for element lookup. For batches, fan the script fetches out in parallel before the sequential execute loop.

To *read* what a local run did rather than replay it, call `muggle-local-run-steps-get` — it returns the steps with the frame each produced. Never parse a session's `action-script.json` by hand.
