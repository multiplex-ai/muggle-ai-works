---
name: muggle-taste-profile
model: sonnet
description: "Build, view, upload or clear the user's taste profile, which test runs use to judge their app their way. Use on muggle taste-profile."
---

# Muggle Taste Profile

> Telemetry first step: see [`_shared/telemetry-emit.md`](../_shared/telemetry-emit.md). Use `skillName: "muggle-taste-profile"`.

> Running outside Claude Code (in Codex, for one)? Read [`../_shared/host-tool-equivalents.md`](../_shared/host-tool-equivalents.md) first — it maps the tools and paths this skill names to your host's.

Muggle flows append **signals** to a local journal (`~/.muggle-ai/taste/signals.jsonl`): review comments a `/muggle-do` cycle addressed, E2E feedback, approved requests. This skill distills them into the **profile** (`~/.muggle-ai/taste/profile.json`): one user-wide section plus one section per Muggle Test project. Once uploaded, Muggle Test runs read it as guidance; a test case's steps and assertions always win over it. The journal never leaves the machine.

## Preferences

Gates run per `preference-gates/README.md`.

| Preference | Step | Decision it gates |
|------------|------|-------------------|
| `tasteProfileUpload` | Build 5 | Upload the screened profile (see [`tasteProfileUpload.md`](../muggle-preferences/preference-gates/tasteProfileUpload.md)) |

## Routing

| Intent | Op |
|---|---|
| "build my taste profile" / "rebuild it" / no arguments | Build |
| "show my taste profile" / "what has muggle learned" | View |
| "clear" / "delete" / "forget my taste" | Clear |

If intent is ambiguous, use `AskUserQuestion` once with **Build / View / Clear**.

## Build

1. **Read.** `muggle-local-taste-signal-list` with no filter. No signals → say that Muggle records them as the user addresses reviews, gives E2E feedback and approves requests, and stop.
2. **Distill.** Group signals by `projectId`; a signal with none goes to the user-wide section. A taste seen in two or more projects also goes user-wide. For each section:
   - Merge signals that express the same taste into one preference: a short imperative `statement` phrased as guidance for a test run ("Primary actions sit bottom-right"), never a quote of the raw comment, never a name, address, URL or credential.
   - `category`: one of `Naming`, `VisualDesign`, `Interaction`, `Copy`, `Workflow`, `QualityBar`.
   - `signalCount`: how many signals support it. `lastSeenAt`: the newest supporting signal's `recordedAt`.
   - Drop one-off fixes that state no reusable taste (a typo, a single bug).
   - Rank by `signalCount`, then `lastSeenAt`, newest first. Where two preferences conflict, keep the one with more and newer support.
   - Keep the statements within 4,000 characters per section; cut from the bottom of the ranking.
   - `distilledAt`: now, ISO-8601.
3. **Write.** `muggle-local-taste-profile-set` with `userSection` and `projectSections`. A rebuild sends every section, which replaces the old ones; clear a project that no longer has signals with `muggle-local-taste-profile-clear` and its `projectId`.
4. **Show.** Print each section as a table: statement, category, signals, last seen.
5. **Upload.** Gate `tasteProfileUpload`:
   - `never` → silent footer; stop.
   - `always` → `muggle-remote-taste-profile-upload`.
   - `ask` → `muggle-remote-taste-profile-upload` first: it returns `needs-consent` with the screened profile. Show what will be sent, then run Picker 1 and Picker 2. On `Upload it` or `Ask me next time`, call it again with `hasUserApprovedThisUpload: true`.
6. **Report.** The tool's `message`; when `redactionCount` > 0, say how many spans were redacted. `UNAUTHORIZED` → hand off to the `muggle-login` skill, then retry step 5. `over-budget` → shorten the named sections and go back to step 3.

## View

1. `muggle-local-taste-profile-get`; print each section as in Build step 4, with its character count against the budget. Empty → offer Build.
2. When signed in, `muggle-remote-taste-profile-get`, and say whether the uploaded copy matches the local one (same statements per section) or is older.

## Clear

`AskUserQuestion`: **Local profile / Uploaded profile / Both**, then whether to clear one project (`projectId`) or everything.

- Local → `muggle-local-taste-profile-clear`.
- Uploaded → `muggle-remote-taste-profile-delete`. Future runs stop using what was deleted.

The journal is kept, so a later Build can restore the profile. To forget the signals too, the user deletes `~/.muggle-ai/taste/signals.jsonl` themselves; say so, never delete it for them.
