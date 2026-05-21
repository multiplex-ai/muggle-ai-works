# Classify

Classify the **review as a unit** — but reply per line comment (threaded), not per review.

## Pre-check: self-loop filter

GitHub auto-creates a synthetic review every time the agent posts `POST /comments/<id>/replies`. That review has the loop user as author, an empty body, and contains only the agent's own reply comments (`in_reply_to_id != null`). It carries no reviewer intent and must not trigger another cycle.

A review is a **self-loop** iff:

- `body` is empty, AND
- every line comment under it has `in_reply_to_id != null`

Self-loops bypass the actionable/ambiguous decision entirely. Action: advance the cursor silently. No push, no reply, no resolve-reminder, no escalation, no entry in `escalated_review_ids`. Telemetry: emit one `cycle` event with `outcome: "self-loop-skip"`.

Only reviews that survive the self-loop check proceed to classify below.

## Actionable vs ambiguous

| Class | Signal | Action |
| :---- | :----- | :----- |
| **actionable** | Review names at least one concrete change or asks an answerable question. Soft phrasing counts when there's a concrete referent. | Treat as amended requirements; run **one** implementation cycle for the whole review; reply **threaded per line comment** referencing the new SHA (top-level only when the review is body-only). |
| **ambiguous** | No actionable signal — pure vibes, contradictory, or depends on knowledge the loop can't access. | Escalate once with two interpretations; pause the PR. |

Default to **actionable**. CI catches wrong attempts; reviewers correct on the next round. Escalation is a round-trip with an absent user — reserve it.

Reply shape (all replies for one review reference the same SHA):

- **threaded** (default): `Done in <sha> — <attribution>. (Review #<review_id>, cycle <status>.)`
- **top-level** (fallback, body-only reviews): `Re: review #<review_id> — addressed in <sha>, cycle <status>.`
- **ambiguous**: no bot reply.

## Worked examples — Actionable

| Review (summarized) | Why actionable |
| :------------------ | :------------- |
| 3 comments: "rename `fooBar` to `foo_bar`", "use `const` here", "fix this typo" | Three concrete edits |
| 1 comment: "could the procedure be simpler?" | Soft-phrased but the intent is clear — simplify |
| Review body: "Two things: extract validation into a helper, add a null check before the lookup." + 0 line comments | Two concrete directives in the body |
| 4 comments: "why this approach?", "is this called from X?", "does this need to handle empty array?", "what's the perf here?" | All questions, each answerable |
| 1 comment: "rewrite this module — the architecture doesn't match the spec" | Substantive rebuild, but direction is clear |
| 1 comment: "I'd lean toward the bar.ts pattern" | Concrete referent (bar.ts) — apply that pattern |

## Worked examples — Ambiguous

| Review (summarized) | Why ambiguous |
| :------------------ | :------------ |
| 1 comment: "👀" / "hmm" / ":thinking:" | No signal at all |
| 1 comment: "this is wrong" with no target or direction | Asserts a problem but doesn't propose a fix |
| 2 comments: "use X" + "but actually don't use X" | Self-contradicting |
| 1 comment: "we discussed this offline — please address" | References context the loop doesn't have |
| 1 comment: "won't this break the prod migration we did last week?" | Implicit change request gated on knowledge the loop can't access |
| Mixed: 2 concrete directives + 1 "rethink the whole approach" | The "rethink" subverts the others; escalate to confirm scope |

Escalate per the caller's procedure (add the review id to the cursor's escalated set, emit one terminal message, pause the PR).

## Borderline rule

If you can paraphrase the review's intent as **"do X"** (X concrete) → actionable. Pick the best interpretation; dispatch.

If you can only paraphrase as **"the reviewer is dissatisfied but I can't tell with what"** → ambiguous.

Mixed ("3 concrete + 1 dissatisfaction") usually splits: action the concrete; ask about the dissatisfaction in the reply summary. Pure ambiguity means *nothing* in the review is actionable.
