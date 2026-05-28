# Final state

Synthesis of the post-fix routing, from validations run in a healthy session (muggle MCP connected). It is reported this way rather than as one 82-query run because a single full pass spawns ~250 `claude -p` sessions and the muggle MCP intermittently disconnects mid-run; when it does, every query after the drop sees no muggle skills and falls to `none`. Two full passes were corrupted exactly that way (a contiguous tail — `muggle-status`, `-repair`, `-upgrade`, `-works-npm-release` — reading 0% despite those skills being unchanged from the 100%-recall baseline, and re-probing 4/4 once reconnected). The per-skill validations below are the reliable signal.

## Baseline → final

| | baseline | final |
|---|---|---|
| muggle-routing accuracy | 79/82 = 96.3% | 82/82 = 100% (projected; see note above) |
| negatives clean (no muggle over-trigger) | 15/15 | 15/15 |
| genuine misses | 3 | 0 |

## Per-skill

| skill | baseline | final | evidence |
|---|---|---|---|
| muggle | 4/4 | 4/4 | baseline |
| muggle-do-task | 5/5 | 5/5 | baseline |
| muggle-feedback | 4/5 ⚠ | **5/5** | fix #198 — targeted re-run 8/8 (`reports/fixes/muggle-feedback.json`) |
| muggle-pr-visual-walkthrough | 5/5 | 5/5 | baseline |
| muggle-preferences | 4/4 | 4/4 | baseline |
| muggle-repair | 4/4 | 4/4 | baseline + re-probe 2/2 |
| muggle-status | 4/4 | 4/4 | baseline + re-probe 2/2 |
| muggle-test | 6/7 ⚠ | **7/7** | fix #212 — targeted re-run 6/6 @5× (`reports/fixes/muggle-test.json`) |
| muggle-test-feature-local | 6/6 | 6/6 | baseline |
| muggle-test-import | 6/6 | 6/6 | baseline |
| muggle-test-prepare | 4/5 ⚠ | **5/5** | fix #213 — targeted re-run 8/8 (`reports/fixes/muggle-test-prepare.json`) |
| muggle-test-regenerate-missing | 5/5 | 5/5 | baseline |
| muggle-upgrade | 3/3 | 3/3 | baseline + re-probe 2/2 |
| muggle-works-npm-release | 4/4 | 4/4 | baseline + re-probe 2/2 |

## Fixes

The three baseline misses, each resolved without disturbing siblings (full analysis in `optimization-log.md`):

1. **muggle-feedback** — a Muggle dashboard URL + "the script is broken at the submit step" routed to `systematic-debugging` (a run critique read as a debug task). Reframed around flagging that a generated Muggle script/step did the wrong thing.
2. **muggle-test** — "validate my changes before I open the PR" routed to `verification-before-completion`, and "did my latest commits break any user flows?" routed to `none`. Claimed the pre-PR acceptance gate explicitly and added the question-form phrasing.
3. **muggle-test-prepare** — "check if localhost:3000 and the api on 8080 are listening before testing" routed to `none`. Claimed port/service readiness checks before testing.

Each fix's targeted re-run also confirmed no new false triggers on the near-miss negatives (e.g. "fix the broken webpack build", "flaky CI test" → `systematic-debugging`; "npm test" → `none`).
