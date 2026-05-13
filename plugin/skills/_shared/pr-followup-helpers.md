# PR follow-up helpers

Generic operational guidance for running a PR-comment follow-up loop on GitHub: reviewer allow-list resolution, reply routing across the different comment endpoints, and a borderline-tested rule for classifying reviewer comments. Shared because the same procedures apply to any caller that runs a stage-8-shaped loop — `muggle-do` is the first, but not the last.

The per-tick contract that consumes these procedures lives in [`../do/pr-followup.md`](../do/pr-followup.md). Keep both files in lockstep — when the contract changes, update both.

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

The decision table in [`../do/pr-followup.md`](../do/pr-followup.md) is the rule. This section is worked examples — read them when classifying a borderline case.

### Directive (comply silently)

Imperative verb on a concrete target. Comply without asking.

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

### Question (reply only)

Ends with `?` and is asking for information, not requesting a change.

| Comment body | Why question |
| :----------- | :------------ |
| "why this approach?" | Asks for rationale |
| "is this called from anywhere else?" | Asks for a fact |
| "does this need to handle the empty-array case?" | Asks for confirmation; if the answer is "yes", it becomes a follow-up directive on a subsequent tick |
| "what's the perf characteristic here?" | Asks for analysis |
| "how does this interact with the cache invalidation?" | Asks for explanation |

Answer inline. If the answer reveals a bug, **escalate** — don't silently follow up with a fix.

### Ambiguous (escalate)

Default. When the comment doesn't cleanly fit directive or question, escalate.

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

For each, escalate per [`../do/pr-followup.md`](../do/pr-followup.md) Step 7. Don't guess.

### Borderline rule

If you can paraphrase the comment as **"do X"** with X being a concrete, verifiable change — it's a directive.

If you can paraphrase it as **"tell me Y"** with Y being a question that doesn't imply a change — it's a question.

Anything else: ambiguous.

Asking yourself "is this what they meant?" three times before classifying as directive is a sign you should escalate instead.
