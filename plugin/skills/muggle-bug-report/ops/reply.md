# Reply on a bug report

## 1. Identify the report

As in [`status.md`](status.md) §1. Fetch it with `muggle-remote-bug-report-get` and print its short id, title, status and the newest timeline entry, so the user answers what was asked.

## 2. Collect the reply

- **Message** — free text; re-ask when blank.
- **Screenshots** — `AskUserQuestion`: **Attach screenshots** / **No screenshots**. When attaching, collect absolute file paths.

## 3. Confirm

Print the message and screenshot file names, then `AskUserQuestion`:

> "Post this reply on <shortId>?"
> - **Post it**
> - **Edit**
> - **Cancel** — print "Cancelled — nothing was sent." and stop

## 4. Post

`muggle-remote-bug-report-reply` with `bugReportId`, `message` and `screenshotPaths`.

| Error | Response |
|---|---|
| `bug_report_reopen_window_elapsed` (409) | "This ticket closed more than 14 days ago and can't be reopened." Offer to file a new report ([`file.md`](file.md)) whose description starts with "Follow-up to <shortId>". |
| A screenshot refused (`INVALID_ARGUMENT`) | Print the message; `AskUserQuestion`: **Fix the path** / **Post without it** |
| Anything else | Print it verbatim; nothing was posted |

## 5. Report

```
Replied on <shortId>.
Track it: <dashboardUrl>
```

A reply on a **Needs info**, **Fixed** or **Closed** ticket sends it back to the team as **Triaged**.
