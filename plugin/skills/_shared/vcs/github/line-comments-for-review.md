# Line comments for a specific review

For per-comment reply routing in `/muggle-do`.

```bash
gh api repos/<owner>/<repo>/pulls/<n>/comments --paginate \
  --jq '[.[] | select(.pull_request_review_id == <review-id>)]'
```
