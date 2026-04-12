---
name: muggle-works-npm-release
description: >-
  Cut @muggleai/works release: AskQuestion (major/minor/patch), sync master, stop if
  nothing ships, semver baseline + Electron from GitHub, confirm plan, bump
  package.json + sync:versions, full local verify, chore(release) PR, merge via gh,
  dispatch publish-works-to-npm.yml—no local npm publish.
---

# Muggle Works — npm release (single playbook)

Repo: **`multiplex-ai/muggle-ai-works`**. Workflow: **`.github/workflows/publish-works-to-npm.yml`** (“Publish Works to npm”). **Never** run local **`npm publish`** (OIDC trusted publishing in CI).

---

## Phase 1 — Ask bump type (do this first)

**Stop until the user answers.**

**Prefer `AskQuestion`** with exactly these three options: **major**, **minor**, **patch** (fix). If the environment has no structured question tool, ask the same in plain text:

> Is this release a **major**, **minor**, or **patch** (fix)?

You may **recommend** a bump from commit subjects (e.g. `feat!` / breaking → major, `feat` → minor, `fix` / `chore` → patch) but **do not** choose for them. **Do not** edit files yet.

---

## Phase 2 — Sync, surface state, empty-release gate

Run from **`muggle-ai-works`**:

```bash
git checkout master && git pull --ff-only && git fetch --tags
```

Show what is shipping:

```bash
node -e 'console.log("master package.json:", require("./package.json").version)'
npm view @muggleai/works version 2>&1 | sed 's/^/npm latest: /'
```

**Commits since the last release commit** (stop if there is nothing to ship):

```bash
LAST_RELEASE_SHA=$(git log --grep='chore(release)' --format='%H' -1)
git log --oneline "$LAST_RELEASE_SHA..HEAD"
```

- If the log is **empty**, tell the user there is **nothing to ship** and **stop** (no branch, no bump, no PR).
- If non-empty, present commits as a short table (subject; PR number from title/body if present).

---

## Phase 3 — Version baseline, Electron, print summary, confirm

### npm version (`nextNpmVersion`)

1. **`npm view @muggleai/works version`** — last published on npm.
2. Root **`package.json` → `version`** on current **`master`** checkout.
3. **Baseline** = **semver-higher** of those two (never target below repo or npm).
4. Apply the user’s **major / minor / patch** to that baseline → **`nextNpmVersion`** (semver-correct).

### Electron (`muggleConfig`)

1. Read **`package.json` → `muggleConfig.electronAppVersion`**.
2. **Latest desktop on GitHub:**  
   `https://api.github.com/repos/multiplex-ai/muggle-ai-works/releases?per_page=30`  
   → newest **`tag_name`** matching **`electron-app-v*`** → strip prefix → **`latestElectronVersion`** (semver only).

### Print (always)

| Item | Value |
| :--- | :---- |
| Last **@muggleai/works** on npm | … |
| **Baseline** for bump | … |
| **`nextNpmVersion`** (to publish) | … |
| Current **`electronAppVersion`** | … |
| Latest **`electron-app-v…`** on GitHub | … |

### Electron bump decision

If **`latestElectronVersion`** ≠ current **`electronAppVersion`**, ask: **bump** Electron + all four **`muggleConfig.checksums`** to **`latestElectronVersion`**, or **keep** current.

If bumping, checksums from:

`https://github.com/multiplex-ai/muggle-ai-works/releases/download/electron-app-vVERSION/checksums.txt`

Map zip artifacts → **`darwin-arm64`**, **`darwin-x64`**, **`win32-x64`**, **`linux-x64`** (same mapping rules as today).

**Stop again:** user must **confirm** the full plan (**`nextNpmVersion`** + Electron choice). If they cancel, **do not** branch, merge, or dispatch CI.

---

## Phase 4 — After explicit confirmation only

### 1. Branch and bump

```bash
git checkout -b "chore/release-<VERSION>"
npm version "<VERSION>" --no-git-tag-version
```

Replace **`<VERSION>`** with **`nextNpmVersion`** (dots in the branch name are fine, e.g. `chore/release-4.8.0`).

- If Electron bump agreed: set **`muggleConfig.electronAppVersion`** and all four **`muggleConfig.checksums`** in **`package.json`**.

### 2. Propagate versions (do not hand-edit manifests)

```bash
pnpm run sync:versions
```

Never hand-edit **`.claude-plugin/marketplace.json`**, **`.cursor-plugin/marketplace.json`**, **`plugin/.claude-plugin/plugin.json`**, **`plugin/.cursor-plugin/plugin.json`**, or **`server.json`** — **`sync-versions`** (and **`build`**) owns them.

If you changed Electron after the first sync, run **`pnpm run sync:versions`** again.

### 3. Full local verify (before push)

```bash
pnpm run lint:check && pnpm run typecheck && pnpm test && pnpm run build && pnpm run verify:plugin && pnpm run verify:contracts && pnpm run verify:electron-release-checksums
```

- **`pnpm run build`** is required before **`verify:plugin`** — the verifier reads the **built** plugin under **`dist/plugin/`**, not source under **`plugin/`**.
- If **anything** fails, **stop** and surface the error; **do not** push a broken release.

### 4. Commit (**`chore(release)`**)

Stage version-touched files (at minimum **`package.json`** plus whatever **`sync:versions`** changed — typically the marketplace/plugin **`server.json`** paths above).

**Subject:** `chore(release): @muggleai/works <VERSION>`

**Body:** one bullet per shipping PR / theme, note **Electron** bump or unchanged, and any coordinated follow-ups in sibling repos (e.g. teaching-service, UI). Use a **heredoc** for `git commit` so newlines are preserved.

### 5. PR, merge, update local **`master`**

```bash
git push -u origin HEAD
gh pr create --repo multiplex-ai/muggle-ai-works --base master --head <branch> \
  --title "chore(release): @muggleai/works <VERSION>" \
  --body "<PR body: version delta, bump rationale, shipping list, Electron status, manifests touched by sync:versions, short test plan checklist>"
```

**Merge:** when the human has approved the release in this session, run **`gh pr merge`** (squash is fine unless the repo prefers merge commits), then:

```bash
git checkout master && git pull --ff-only
node -e 'console.log("master now:", require("./package.json").version)'
```

Confirm **`package.json`** on **`master`** matches **`nextNpmVersion`** before publishing.

---

## Phase 5 — Trigger publish (CI only)

Prefer **explicit version** (not “auto bump”):

```bash
gh workflow run publish-works-to-npm.yml --repo multiplex-ai/muggle-ai-works --ref master \
  --field "version=<VERSION>" --field "bump=patch"
```

The `bump=patch` field is a harmless placeholder when `version` is set; the workflow prefers the explicit `version` input.

**Or** **`git tag "v<VERSION>"`** && **`git push origin "v<VERSION>"`** only if that tag **does not** already exist on the remote; if the tag exists, use **`workflow_dispatch`** with **`version`**.

Watch the run and confirm jobs succeed:

```bash
gh run list --repo multiplex-ai/muggle-ai-works --workflow=publish-works-to-npm.yml --limit 1
gh run watch <RUN_ID> --repo multiplex-ai/muggle-ai-works --exit-status
```

Verify the registry:

```bash
npm view @muggleai/works version
```

Give the user the **Actions run URL**. If npm lags, wait ~60s and retry.

---

## Rules

- **No local `npm publish`.**
- **Phase 1:** use **`AskQuestion`** for major / minor / patch when available (see Phase 1).
- Phases 1–3: keep chat concise; Phase 4–5 can be terse status lines.
- If the user cancels after Phase 3, **do not** merge or dispatch CI.
- **Tag vs npm:** **`v*`** tags are for the **npm** package; **`electron-app-v*`** is separate — **`electronAppVersion`** can move independently of **`version`**.

---

## Notes (troubleshooting)

- Workflow **`name:`** / filename is tied to npm **Trusted Publishing** — see the comment block at the top of **`publish-works-to-npm.yml`** if auth fails.
- If commits land on **`master`** between opening the PR and merging, re-check **`git log`** vs the last **`chore(release)`** before merging; rebasing the release branch may be needed so **`master`** still matches what you intend to ship.
