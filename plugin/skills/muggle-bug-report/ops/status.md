# Bug report status

## 1. Identify the report

- A `BUG-NNNN` or `bugReportId` in the prompt → resolve it per SKILL.md's short-id constraint.
- A row from a list shown earlier → use its `bugReportId`.
- Nothing named → run [`list.md`](list.md) and let the user pick.

## 2. Fetch

`muggle-remote-bug-report-get` with the `bugReportId`.

## 3. Render

```
<shortId>: <title>
Status:   <status in words>  (<closeReason in words, and duplicateOfShortId, when closed>)
Severity: <severity>    Priority: <priority, or "not set yet">
Filed:    <createdAtMs, human-readable>
Track it: <dashboardUrl>

What you reported:
  <description>
  <steps / expected / actual when present>
```

Then the timeline, oldest first, one entry per activity:

- `filed` → "Filed"
- `status_change` → "<actorDisplayName>: <fromStatus> → <toStatus>" plus the message when present
- `priority_change` → "<actorDisplayName>: priority <fromPriority> → <toPriority>"
- `note` → "<actorDisplayName>: <message>"
- `filer_reply` → "You: <message>"

Add "(N screenshots)" to an entry that has them.

## 4. Offer next action

When the status is **Needs info**, say the team is waiting on the user's answer.

`AskUserQuestion`:

> "What next?"
> - **Reply** — [`reply.md`](reply.md) with this `bugReportId`
> - **Done**
