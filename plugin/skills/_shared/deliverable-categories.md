# Deliverable categories

A **deliverable** is the artifact an acceptance criterion is about. Its **deliverable category** is one of `web`, `video`, `image`, `audio`, `data`, `research` — the one list of categories, which other files reference rather than restate. No category is special-cased: each criterion is verified the way its category's flow file declares under **Verified by** — **test cases** (Muggle browser test cases, run against the app) or a **deliverable check** (obtain the artifact, probe it, review it, return a verdict). Scoping and the acceptance stage read that declaration from the criterion's category and never branch on a category's name.

## Tagging a criterion

Every criterion carries exactly one category, written as a leading tag: `- [video] The promo renders at 1080×1920 and runs 28–32 s`. A criterion spanning two categories (a page that embeds a new video) is split into one criterion per category. A criterion about something a user does in a browser is `[web]`. A criterion no category can observe — a log line, a config value, a unit-test requirement — is still tagged with the category of the artifact it concerns, and impact analysis scopes it `unobservable`.

## Obtaining the artifact

- **Committed** — a file at the branch head is checked as committed, read from the PR's worktree.
- **Built** — an artifact the change produces (a render, an export, a generated report) is built with the repo's own command, run from the PR's worktree at head, writing into a scratch directory outside the worktree.

A check never commits, moves, or edits what it obtains. A build that fails because the change is broken is a `FAIL`; a build that fails because the environment lacks something (a missing binary, no network) is `INCONCLUSIVE`, naming it.

## Probes and review

A **probe** measures one property and compares it with the expected value the criterion states, or the value the scope planned when the criterion implies one. A rerun on the same artifact measures the same value. A **review** is the agent's inspection of the content against the criterion; the report labels every review finding as agent judgment.

Media probes use `ffprobe`, and frame extraction and media filters use `ffmpeg`. A probe whose tool is missing makes the check `INCONCLUSIVE` with reason `probe tool missing: <tool>` — never a silent pass, never a skipped probe.

## Category flows

Every category's flow lives in its own file, so it can be customized without touching the others. Each file declares **Verified by**, then names the artifact, how it is verified, and when the verification is `INCONCLUSIVE`; the rules on this page apply to all of them. Changing a category's **Verified by** changes how its criteria are scoped and run, with no edit anywhere else.

| Category | Verified by | Flow |
| :-- | :-- | :-- |
| web | test cases | [`deliverable-categories/web.md`](deliverable-categories/web.md) |
| video | deliverable check | [`deliverable-categories/video.md`](deliverable-categories/video.md) |
| image | deliverable check | [`deliverable-categories/image.md`](deliverable-categories/image.md) |
| audio | deliverable check | [`deliverable-categories/audio.md`](deliverable-categories/audio.md) |
| data | deliverable check | [`deliverable-categories/data.md`](deliverable-categories/data.md) |
| research | deliverable check | [`deliverable-categories/research.md`](deliverable-categories/research.md) |

Scoping and the acceptance stage open the flow file of every category the cycle's criteria carry before planning or running anything.

## Verdict

- **PASS** — every probe and review passed.
- **FAIL** — a probe or review failed on an artifact that was obtained. The entry names the probe or review, the expected value, and the observed one.
- **INCONCLUSIVE** — the artifact could not be obtained for an environment reason, a required tool is missing, or a source could not be reached. The product is not implicated.

## Report entry

```
- (deliverable name):
  - key: <DC key from the scope>
  - category: <video | image | audio | data | research>
  - artifact: <repo-relative path, or the build command and its scratch output>
  - criteria: <the criteria it verifies>
  - checks: [{ check, kind: probe | review, expected, observed, passed }, ...]
  - verdict: PASS | FAIL | INCONCLUSIVE
  - reason: <one short sentence; FAIL and INCONCLUSIVE only>
  - evidenceDir: <scratch directory holding extracted frames, transcripts, probe output>
```

## Evidence on the PR

Deliverable checks are run by the agent and are not recorded on the Muggle dashboard, so they never go under the walkthrough heading or its slot marker — that heading is Muggle vouching for a recorded run. They go in the PR body's `## Validation` section as one table per check:

```
**[video] Promo render** — PASS
| Check | Kind | Expected | Observed |
| :-- | :-- | :-- | :-- |
| duration | probe | 28–32 s | 30.04 s |
| end-card text | review (agent judgment) | "Try Muggle" | "Try Muggle" |
```

The table is followed by one line: `Deliverable checks ran in this PR's worktree at <short sha>; they are not recorded on the Muggle dashboard.` An image committed at head is embedded under its table by its blob URL at that commit, with `?raw=true`.
