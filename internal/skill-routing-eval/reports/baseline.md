# Router eval report

- model: `default`  runs/query: 3
- overall accuracy (muggle-routing): **79/82 = 96.3%**
- negative-class rule: a query labeled `none` passes when no `muggle*` skill fires; an appropriate non-muggle skill (debugging, review, brainstorming) winning is correct.

## Per-skill recall (positive queries)

| skill | correct | total | recall | stolen by (majority when wrong) |
|---|---|---|---|---|
| muggle | 4 | 4 | 100% | — |
| muggle-do-task | 5 | 5 | 100% | — |
| muggle-feedback | 4 | 5 | 80%  ⚠ | systematic-debugging×1 |
| muggle-pr-visual-walkthrough | 5 | 5 | 100% | — |
| muggle-preferences | 4 | 4 | 100% | — |
| muggle-repair | 4 | 4 | 100% | — |
| muggle-status | 4 | 4 | 100% | — |
| muggle-test | 6 | 7 | 86%  ⚠ | none×1 |
| muggle-test-feature-local | 6 | 6 | 100% | — |
| muggle-test-import | 6 | 6 | 100% | — |
| muggle-test-prepare | 4 | 5 | 80%  ⚠ | none×1 |
| muggle-test-regenerate-missing | 5 | 5 | 100% | — |
| muggle-upgrade | 3 | 3 | 100% | — |
| muggle-works-npm-release | 4 | 4 | 100% | — |

## Negative class (must not fire a muggle skill)

- 15/15 clean (no muggle skill fired).
- No muggle skill over-triggered on any near-miss. ✔

## Genuine misses

- expected `muggle-test` got `none` — validate my changes before I open the PR  (fired: {'none': 1, 'TIMEOUT': 1, 'verification-before-completion': 1})
- expected `muggle-test-prepare` got `none` — check if localhost:3000 and the api on 8080 are listening before testing  (fired: {'none': 3})
- expected `muggle-feedback` got `systematic-debugging` — here's the dashboard link https://app.muggle.dev/runs/abc123 — the script i  (fired: {'none': 1, 'systematic-debugging': 2})
