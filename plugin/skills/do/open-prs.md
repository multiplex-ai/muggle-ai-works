# Create-or-Update PR (Stages 5.5 and 7)

Two modes, set by the `/muggle-do` invocation. Each consumer loads only its mode's file.

| Mode | When | Procedure |
| :--- | :--- | :-------- |
| Forward | A fresh feature, called by `/muggle-do`'s forward pipeline. Opens the PR after Stage 5 (Stage 5.5) and arms its watch with cycles held, settles its walkthrough after Stage 6 (Stage 7), lifts the hold at Stage 8. | [`open-prs/forward.md`](open-prs/forward.md) |
| Update | The PR already exists; the address-reviews orchestrator called this stage to push + refresh title/description/walkthrough. | [`open-prs/update.md`](open-prs/update.md) |
