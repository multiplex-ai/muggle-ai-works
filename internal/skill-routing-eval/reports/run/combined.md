# Router eval report

- model: `claude (run.py)`  runs/query: 1
- overall accuracy (muggle-routing): **23/24 = 95.8%**
- negative-class rule: a query labeled `none` passes when no `muggle*` skill fires; an appropriate non-muggle skill (debugging, review, brainstorming) winning is correct.

## Per-skill recall (positive queries)

| skill | correct | total | recall | stolen by (majority when wrong) |
|---|---|---|---|---|
| muggle-status | 23 | 24 | 96%  ⚠ | none×1 |

## Negative class (must not fire a muggle skill)

- 0/0 clean (no muggle skill fired).
- No muggle skill over-triggered on any near-miss. ✔

## Genuine misses

- expected `muggle-status` got `none` — Is the muggle MCP server reachable from here? Just checking.  (fired: {'none': 1})
