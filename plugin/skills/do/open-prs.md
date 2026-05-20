# Create-or-Update PR (Stage 7)

Two modes, set by the `/muggle-do` invocation. Each consumer loads only its mode's file.

| Mode | When | Procedure |
| :--- | :--- | :-------- |
| Forward | After stages 1–6 of a fresh feature (called by `/muggle-do`'s forward pipeline). Creates the PR, seeds state, dispatches the first watcher. | [`open-prs/forward.md`](open-prs/forward.md) |
| Update | The PR already exists; the address-reviews orchestrator called this stage to push + refresh title/description/walkthrough. | [`open-prs/update.md`](open-prs/update.md) |
