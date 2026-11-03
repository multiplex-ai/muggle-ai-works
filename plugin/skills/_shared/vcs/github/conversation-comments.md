# PR conversation comments

Top-level comments on the PR's Conversation tab — GitHub's issue comments, outside any review or thread. For the watcher's dispatch trigger and the address-reviews work set.

```bash
gh api repos/<owner>/<repo>/issues/<n>/comments --paginate \
  --jq '.[] | {id: .id, body: .body, author: .user.login, authorType: .user.type, createdAt: .created_at, url: .html_url}'
```

A comment is **actionable** when all hold:

- `id > last_seen.lastConversationCommentId`
- `id` not in `last_seen.escalated_conversation_comment_ids`
- not posted by muggle: the body carries no `<!-- muggle-` marker (the loop marker `<!-- muggle-do:bot -->`, `<!-- muggle-works:signature -->`, the walkthrough and PR-section markers) and, outside its `>` quote lines, no visible Muggle Works signature link — see [`../../pr-followup-helpers/loop-signature.md`](../../pr-followup-helpers/loop-signature.md). A human quote-reply copies the quoted post's signature, so quoted lines never count.
- not a bot: `authorType` is not `Bot`, the login does not end in `[bot]`, and it is not `github-actions`
- `author` is in the resolved reviewer allow-list

The watch loop applies the same muggle and bot exclusions in `scripts/pr-watch-state.jq` (`muggle_posted`, `bot_authored`); that file is the definition, this list mirrors it.

Issue comments have no threading: GitHub offers no reply endpoint, and the loop never edits a human's comment. Each one is answered with its own loop-signed top-level PR comment that quotes and links it.

Issue-comment ids are a sequence of their own, separate from review and review-comment ids, which is why they keep their own watermark rather than sharing `lastBodyReviewId`.
