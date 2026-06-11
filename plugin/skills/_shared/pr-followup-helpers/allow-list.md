# Reviewer allow-list

The address-reviews flow only acts on reviews submitted by users in the **allow-list** = (requested reviewers ∪ CODEOWNERS ∪ {PR author}) − bots. Re-resolve every invocation — never cache across cycles.

The PR author is implicitly a valid reviewer: in single-account workflows, the human running the agent and the PR's author are the same identity, and the agent must honor their reviews. Self-loop is prevented at the watcher's filter layer rather than here: `POST /pulls/<n>/comments/<id>/replies` does create an implicit review under the loop user's identity, and the watcher drops it via the loop-echo clause in [`../vcs/github/submitted-reviews.md`](../vcs/github/submitted-reviews.md) — matched by the loop signature ([`loop-signature.md`](loop-signature.md)), so the author's *genuine* reviews and thread replies still get through. Including the PR author in this allow-list is therefore safe.

## Step 1: requested reviewers

```bash
gh pr view <number> --repo <owner>/<repo> --json reviewRequests,author
```

`reviewRequests` is an array of `{ login? , slug? }`. User reviewers have `login`; team reviewers have `slug` (and `name`). Expand teams to member logins:

```bash
gh api orgs/<org>/teams/<slug>/members --jq '.[].login'
```

Record `prAuthor = author.login` for the inclusion step.

## Step 2: CODEOWNERS

Look for the file in this order — first hit wins:

1. `.github/CODEOWNERS`
2. `CODEOWNERS`
3. `docs/CODEOWNERS`

Read from the PR's **head branch** (not master) — a PR that adds CODEOWNERS should be informational while open, load-bearing once merged:

```bash
gh api repos/<owner>/<repo>/contents/.github/CODEOWNERS?ref=<head_sha> --jq '.content' | base64 -d
```

Parse line-by-line:

- Skip blank lines and lines starting with `#`.
- Each line is `<pattern> <owner1> <owner2> ...`.
- Owners are either `@user` or `@org/team`. Strip the leading `@`.
- Collect the union of all owners across all lines (don't match patterns against changed files — repo-level membership is enough).

Expand `@org/team` to member logins via the orgs/teams/members endpoint.

If no CODEOWNERS file exists in any location, the CODEOWNERS contribution is empty. Don't fail.

## Step 3: filter

Allow-list = (requested reviewers ∪ CODEOWNERS ∪ `{prAuthor}`) − bot logins.

Bot logins:

- Ends with `[bot]` (e.g. `dependabot[bot]`)
- Exact match: `dependabot`, `github-actions`, `renovate`, `mergify`

A comment author not in the allow-list is silently ignored — do not reply, do not address.
