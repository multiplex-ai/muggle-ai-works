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

The unit of work is a **submitted review**, not an individual line comment. Reviewers leave several comments as one review pass; the loop addresses the whole review as one cycle. Classify the review as a unit.

| Class | Signals | Action shape |
| :---- | :------ | :----------- |
| **actionable** | The review body + its comments collectively give enough direction to amend the requirements. At least one comment names a concrete change ("rename X", "extract Y", "use `const`", "this should be async", "fix the typo on line 42") OR asks an answerable question that the loop can address by an edit-and-test pass ("does this handle the empty-array case?" — usually means: if no, add the handling). Soft-phrased "could X be simpler?" / "have you considered Y?" / "this feels heavy" count as actionable when there's a concrete X or Y to act on. | Treat the review as amended requirements. Re-route through the caller's full implementation cycle (build → unit tests → E2E → walkthrough → push). Reply with one summary referencing the new SHA. |
| **ambiguous** (default when actionable isn't clearly true) | Comments collectively give no actionable direction — vibes-only ("👀", "hmm", "this is wrong" with no target), contradictory comments (one comment says "use X" another says "but not X"), references context the loop doesn't have ("we discussed this offline"), or asks questions that depend on knowledge the loop can't access ("won't this break the prod migration we did last week?"). | Escalate to the user once with the two best interpretations; pause the PR until the user resolves. |

Default toward **actionable**. The cost of one wrong cycle is bounded (CI catches it, the reviewer corrects on the next round). The cost of an unnecessary escalation is a round-trip with the user when they're already away — defeats the fire-and-review promise.

**When in doubt:** pick the best interpretation, run the cycle, and let the reply summary make the interpretation explicit. The reviewer corrects in the next round if needed.

**Reply summary shape:**

- **actionable**: `Addressed review <review_id> in <sha> — Stage 3–6 ran clean (or: with <N> failures, see walkthrough). Fresh walkthrough above.` Per-comment inline replies optional.
- **ambiguous**: no bot reply; the escalation message goes to the user terminal.

### Worked examples — Actionable reviews

| Review (summarized) | Why actionable |
| :------------------ | :------------- |
| 3 comments: "rename `fooBar` to `foo_bar`", "use `const` here", "fix this typo" | Three concrete edits |
| 1 comment: "could the procedure be simpler?" | Soft-phrased but the intent is clear — simplify; pick the best interpretation, run the cycle, reply with what was changed |
| Review body: "Mostly looks good. Two things: extract the validation into a helper, and add a null check before the lookup." Plus 0 line comments. | Two concrete directives in the body |
| 4 comments: "why this approach?", "is this called from X?", "does this need to handle empty array?", "what's the perf here?" | All questions but each is answerable; cycle dispatches an "answer + maybe-fix" pass and the reply summary captures each answer |
| 1 comment: "rewrite this module — the architecture doesn't match the spec" | Substantive rebuild, but the direction is clear: redo the module per the spec |
| 1 comment: "I'd lean toward the bar.ts pattern" | Concrete referent (bar.ts) — apply that pattern |

The single review goes through one full cycle regardless of comment count.

### Worked examples — Ambiguous reviews

| Review (summarized) | Why ambiguous |
| :------------------ | :------------ |
| 1 comment: "👀" / "hmm" / ":thinking:" | No signal at all |
| 1 comment: "this is wrong" with no target or direction | Asserts a problem but doesn't propose a fix |
| 2 comments: "use X" + "but actually don't use X" | Self-contradicting — can't reconcile without the reviewer |
| 1 comment: "we discussed this offline — please address" | References context the loop doesn't have |
| 1 comment: "won't this break the prod migration we did last week?" | Implicit change request gated on knowledge the loop can't access |
| Mixed: 2 concrete directives + 1 comment "but also, rethink the whole approach" | The "rethink the whole approach" subverts the other two; escalate to confirm scope |

Escalate per the caller's escalation procedure (write the review id to the cursor's escalated set, emit one terminal message with both interpretations, pause the PR until the user resolves).

### Borderline rule

If you can paraphrase the review's intent as **"do X"** with X being a concrete change (one or several) — it's actionable. Pick the best interpretation and dispatch the cycle.

If you can paraphrase it only as **"the reviewer is dissatisfied but I can't tell with what"** — it's ambiguous.

When the review mixes both ("3 concrete directives + 1 dissatisfaction"), the safer move is usually to action the concrete directives and ask about the dissatisfaction in the reply summary. Pure ambiguity means *nothing* in the review is actionable.
