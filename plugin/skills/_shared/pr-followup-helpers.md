# PR follow-up helpers

Generic operational guidance for running a PR-comment follow-up loop on GitHub: reviewer allow-list resolution, reply routing across the different comment endpoints, and a classification rule for reviewer comments with worked examples and a borderline test. Caller-agnostic — any loop that picks one comment per tick and decides what to do with it can drive off this doc.

The classification produces an **action shape** (in-place change, deep-cycle through the caller's implementation pipeline, reply only, escalate, etc.) — the caller maps each shape to its specific routing (which stage to dispatch, which terminal-message template to use, which reply endpoint to hit).

## Resolving the reviewer allow-list

Stage 8 only acts on comments authored by users in the **allow-list** = (requested reviewers ∪ CODEOWNERS) − bots − PR author. Re-resolve every tick (decision 9 in the design doc).

### Step 1: requested reviewers

```bash
gh pr view <number> --repo <owner>/<repo> --json reviewRequests,author
```

`reviewRequests` is an array of `{ login? , slug? }`. User reviewers have `login`; team reviewers have `slug` (and `name`). Expand teams to member logins:

```bash
gh api orgs/<org>/teams/<slug>/members --jq '.[].login'
```

Record `prAuthor = author.login` for the exclusion step.

### Step 2: CODEOWNERS

Look for the file in this order — first hit wins:

1. `.github/CODEOWNERS`
2. `CODEOWNERS`
3. `docs/CODEOWNERS`

Read from the PR's **head branch** (not master), because a PR that adds CODEOWNERS should be allowed to take effect once merged but is informational while open. In practice this means:

```bash
gh api repos/<owner>/<repo>/contents/.github/CODEOWNERS?ref=<head_sha> --jq '.content' | base64 -d
```

Parse line-by-line:

- Skip blank lines and lines starting with `#`.
- Each line is `<pattern> <owner1> <owner2> ...`.
- Owners are either `@user` or `@org/team`. Strip the leading `@`.
- For our purposes we don't need to match `<pattern>` against changed files — CODEOWNERS membership for the *repo* is enough. Collect the union of all owners across all lines.

Expand `@org/team` to member logins via the orgs/teams/members endpoint (same as Step 1).

If no CODEOWNERS file exists in any of the three locations, the CODEOWNERS contribution is empty. Don't fail.

### Step 3: filter

Allow-list = (requested reviewers ∪ CODEOWNERS) − `{prAuthor}` − bot logins.

Bot logins are any login matching:

- Ends with `[bot]` (e.g. `dependabot[bot]`)
- Exact match in the standard list: `dependabot`, `github-actions`, `renovate`, `mergify`

A comment author not in the allow-list is silently ignored — do not reply, do not address.

## Reply routing

GitHub's PR APIs are not uniform across comment types. Route by parent type.

### Line-level review comment

A comment attached to a specific file:line that belongs to a review thread. This is the **most common** path.

```bash
gh api \
  --method POST \
  -H "Accept: application/vnd.github+json" \
  /repos/<owner>/<repo>/pulls/<number>/comments/<comment_id>/replies \
  -f body="Done in $(git rev-parse --short HEAD) — renamed \`fooBar\` to \`foo_bar\`."
```

The reply lands in the same review thread. The reply itself becomes a new line-level comment with `in_reply_to_id = <comment_id>`.

### Review body (CHANGES_REQUESTED with no inline comments)

A reviewer left a summary review with `state: CHANGES_REQUESTED` and a body, but **no** inline comments. GitHub has no "reply to review body" endpoint — post a top-level PR comment that references the review:

```bash
gh pr comment <number> --repo <owner>/<repo> --body "Re: review #<review_id> — done in $(git rev-parse --short HEAD)."
```

### Failing CI check

No reply. The fix commit IS the response. Include the failing check name in the commit subject so the connection is obvious in `git log`:

```
fix(ci): typecheck — narrow type of foo
fix(ci): lint — remove unused import
```

### Never

- Never post a top-level comment in reply to a line-level comment. It loses thread context and pollutes the PR conversation tab.
- Never `gh pr review --comment` for replies — that endpoint is for *new* reviews, not replies.
- Never reply twice to the same comment. The cursor in `last_seen.json` is the only re-entry guard; advance it after every reply.

## Classify

Each picked comment falls into one of five classes. The class determines the **action shape** the caller should apply.

| Class | Signals | Action shape |
| :---- | :------ | :----------- |
| **directive — in-place** | Imperative verb on a concrete, mechanical target: rename, extract, add a null check, use `const`, fix a typo. The change is localized — one file, a handful of lines. | Apply the change directly; commit; push; reply with the new commit reference. |
| **directive — deep-cycle** | Imperative on a non-trivial implementation target: "rewrite this module", "the approach is wrong, use X pattern instead", "extract these three things into a shared library", "the architecture doesn't match the spec — redo it". Substantive, multi-file, requires re-reasoning about the requirements. | Re-route through the caller's full implementation cycle (build → tests → push). Reply only after the cycle completes; the reply text notes the rebuild. |
| **question** | Ends with `?` and is asking for information, not requesting a change. | Reply inline with the answer; no code change; no push. If the answer reveals a bug, escalate — don't silently follow up with a fix. |
| **CI failure** | Source is a failing check, not a comment. | Read the failing job log, fix, commit, push. No reply — the fix commit is the response. The commit subject should reference the failing check by name. |
| **ambiguous** (default) | Proposes an alternative without instructing ("I think we should use Z instead", "Have you considered Y?"), conflicts with a deliberate choice in the PR description or design doc, or mixes question and change request in one comment. | Escalate to the user once with both possible interpretations; pause the PR (write the comment id to the cursor's escalated set) until the user resolves. |

When the comment matches neither **directive** nor **question** cleanly, default to **ambiguous**. Do not guess. The cost of escalating a directive that could have been auto-handled is small; the cost of pushing a wrong change because we guessed is large.

**Distinguishing in-place from deep-cycle directives:** if the change can be made in under ~20 lines across a single file by following the comment literally, it's in-place. If it requires re-reasoning about *what* to build (not just *how*), it's deep-cycle — even if the final diff is small. When in doubt, prefer deep-cycle: cycling through the full pipeline gives the change unit-test and E2E coverage before pushing.

**Adaptive reply text** by class:

- **directive — in-place**: short, one-line. `Done in <sha> — renamed \`fooBar\` to \`foo_bar\` per request.`
- **directive — deep-cycle**: same one-line shape, but reply only after the full cycle lands. `Done in <sha> after rebuild — <one-line>`.
- **question**: answer inline. Reply length matches the question's complexity — don't write three paragraphs to answer yes/no.
- **CI failure**: no comment to reply to; the fix commit is the response.
- **ambiguous**: no reply from the bot — the escalation goes to the user, who replies themselves.

### Worked examples — Directive

| Comment body | Why directive |
| :----------- | :------------ |
| "rename `fooBar` to `foo_bar`" | Concrete rename, no ambiguity |
| "extract this into a helper" | Action verb on a specific block |
| "add a null check before the access" | Specific change at a specific site |
| "remove this branch — unreachable" | Delete instruction with justification |
| "use `const` here, not `let`" | Token-level change |
| "this should be `async`" | Concrete modifier change |
| "delete the commented-out code on line 42" | Specific deletion target |
| "missing semicolon" | Mechanical fix |
| "typo: `recieve` → `receive`" | Mechanical fix |
| "the import on line 3 is unused" | Implicit delete, unambiguous target |

A **CHANGES_REQUESTED review body** that reads as a bulleted list of the above is also a directive — handle each bullet as a separate item over successive ticks.

If the comment instructs a non-trivial restructure ("rewrite this module", "the architecture is wrong, redo it"), it's still a directive — but **deep-cycle**, not in-place. Same comply-without-asking principle, different action shape.

### Worked examples — Question

| Comment body | Why question |
| :----------- | :------------ |
| "why this approach?" | Asks for rationale |
| "is this called from anywhere else?" | Asks for a fact |
| "does this need to handle the empty-array case?" | Asks for confirmation; if the answer is "yes", it becomes a follow-up directive on a subsequent tick |
| "what's the perf characteristic here?" | Asks for analysis |
| "how does this interact with the cache invalidation?" | Asks for explanation |

Answer inline. If the answer reveals a bug, **escalate** — don't silently follow up with a fix.

### Worked examples — Ambiguous

| Comment body | Why ambiguous |
| :----------- | :------------ |
| "I think we should use a generator here instead" | Proposes an alternative without instructing |
| "have you considered `Promise.all`?" | Rhetorical alternative — directive or question? |
| "this feels like it should be its own module" | Subjective design comment, no concrete action |
| "couldn't this be simpler?" | Pushes for change without specifying what |
| "I'd lean toward the other pattern we used in `bar.ts`" | Conflicts with deliberate choice, needs human call |
| "rename to `foo_bar`. also, why is this needed at all?" | Mixes directive + question — split or escalate |
| "won't this break X?" | Implicit change request *if* the answer is yes |
| "👀" / "hmm" / ":thinking:" | No directive, no question, no signal |
| "this is wrong" | Asserts a problem but doesn't propose a fix |
| "we discussed this offline — please address" | References context the loop doesn't have |

For each, escalate per the caller's escalation procedure (write the comment id to the cursor's escalated set, emit one terminal message with both interpretations, pause the PR until the user resolves). Don't guess.

### Borderline rule

If you can paraphrase the comment as **"do X"** with X being a concrete, verifiable change — it's a directive.

If you can paraphrase it as **"tell me Y"** with Y being a question that doesn't imply a change — it's a question.

Anything else: ambiguous.

Asking yourself "is this what they meant?" three times before classifying as directive is a sign you should escalate instead.
