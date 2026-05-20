# PR follow-up helpers

Generic operational guidance for PR-review follow-up. Caller-agnostic — the watcher fetches reviews, the caller (today: `/muggle-do` in address-reviews mode) reads these files to classify and decide what to do.

Each section is its own file — load only what the current step needs.

## Index

| Section | Use case |
| :------ | :------- |
| [`allow-list`](pr-followup-helpers/allow-list.md) | Resolve who counts as a reviewer (requested reviewers ∪ CODEOWNERS − bots − author). |
| [`reply-routing`](pr-followup-helpers/reply-routing.md) | Pick the right reply endpoint per comment type (line, body-only, CI failure). |
| [`classify`](pr-followup-helpers/classify.md) | Per-review binary label: actionable vs ambiguous, with worked examples + borderline rule. |
