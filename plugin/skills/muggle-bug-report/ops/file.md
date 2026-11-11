# File a bug

## 1. Ask what went wrong

Take what the user already said from the prompt or arguments; ask only for what is missing.

- **Title** — one line. Draft it from their description and let them edit.
- **What happened** — the description, in their words.
- **Severity** — `AskUserQuestion`: **Blocker** (can't continue) / **Major** (works around it with effort) / **Minor** (cosmetic or small). Wire values: `blocker`, `major`, `minor`.
- **Steps / expected / actual** — `AskUserQuestion`: **Add steps, expected and actual** / **Skip**. When added, collect each as free text.
- **Screenshots** — `AskUserQuestion`: **Attach screenshots** / **No screenshots**. When attaching, collect absolute file paths.

## 2. Route a script-step report to feedback

If the report is about one generated test script or one of its steps doing the wrong thing (clicked the wrong element, step N failed, wrong text typed), `AskUserQuestion`:

> "This sounds like script feedback, which regenerates the script. Which do you want?"
> - **Script feedback** — invoke the `muggle-feedback` skill via the Skill tool with the user's description as `args`, then stop.
> - **Bug report anyway**

Anything else — a command or tool error, a hang, a crash, a dashboard or billing problem — continues here.

## 3. Gather and show context

Call `muggle-local-bug-report-context-get` with `cwd` set to the current working directory. It returns the CLI and Studio versions, operating system, last-used project and newest local run, with secret-looking values already left out.

Print the report as it will be sent:

```
Title:     <title>
Severity:  <Blocker | Major | Minor>
What happened:
  <description>
Steps / expected / actual: <each, or "none">
Screenshots: <file names, or "none">

Included with your report:
  <each context line from the tool, plus any "left out" line>
```

## 4. Confirm

`AskUserQuestion`:

> "File this bug report?"
> - **File it**
> - **Edit** — ask which part, collect the change, then print §3 again
> - **Cancel** — print "Cancelled — nothing was sent." and stop

## 5. File

Call `muggle-remote-bug-report-create` with `title`, `description`, `severity`, the optional `stepsToReproduce` / `expectedBehavior` / `actualBehavior`, `screenshotPaths`, and `clientContext` set to the tool's `clientContext` JSON block unchanged.

| Error | Response |
|---|---|
| A screenshot refused (`INVALID_ARGUMENT`) | Print the message; `AskUserQuestion`: **Fix the path** / **File without it** |
| `bug_report_rate_limited` (429) | "You have filed 10 reports in the last hour. Try again later." Stop. |
| `UNAUTHORIZED` | Hand off to `muggle-login`, then retry once |
| Anything else | Print it verbatim; nothing was filed |

## 6. Report

```
Filed <shortId>: <title>
Track it: <dashboardUrl>
```

Updates arrive in the dashboard inbox. Check later with "status <shortId>".
