# List bug reports

## 1. Fetch

`muggle-remote-bug-report-list` with `pageSize: 20`. No items → print "You have not filed any bug reports." and offer `AskUserQuestion`: **File a bug** ([`file.md`](file.md)) / **Done**.

## 2. Render

Newest activity first, as the response orders it:

| Short id | Title | Status | Severity | Last update |
|---|---|---|---|---|

- **Status** — the wire value in words: `new` → New, `triaged` → Triaged, `in_progress` → In progress, `needs_info` → Needs info, `fixed` → Fixed, `closed` → Closed.
- **Last update** — `lastActivityAtMs`, human-readable (e.g. `2 days ago`).
- Mark a **Needs info** row "waiting on you".

When `nextCursor` is set, add "More reports exist" and offer **Show more** in §3.

Print the response's `dashboardUrl` as the link to all reports.

## 3. Offer next action

`AskUserQuestion`:

> "What next?"
> - **Open one** — pick a row, then [`status.md`](status.md)
> - **Reply to one** — pick a row, then [`reply.md`](reply.md)
> - **Show more** — only when `nextCursor` is set; fetch with `cursor: nextCursor` and append
> - **Done**
