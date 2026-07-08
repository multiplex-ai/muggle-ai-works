# Output templates

All user-facing message text used by the watcher, bootstrap, and `/muggle-do` in address-reviews mode. Each template group is its own file — load only what the current step emits.

## Index

| Group | Use case |
| :---- | :------- |
| [`bootstrap`](output-templates/bootstrap.md) | Bootstrap success summary + all bootstrap aborts. |
| [`watcher-log`](output-templates/watcher-log.md) | The `followup.log` line shapes (idle, dispatching, blocked, terminal). |
| [`blocked-reminder`](output-templates/blocked-reminder.md) | The watcher's one-line owner reminder while a PR is blocked pending a human. |
| [`escalation`](output-templates/escalation.md) | `/muggle-do` terminal escalation messages (ambiguous, design-adjustment). |
| [`inline-reply`](output-templates/inline-reply.md) | Per-comment inline reply + top-level fallback for body-only reviews. |
| [`resolve-reminder`](output-templates/resolve-reminder.md) | Top-level PR comment for the resolve-reminder stage. |
| [`help`](output-templates/help.md) | Skill help output (no args / `help` / `?`). |
