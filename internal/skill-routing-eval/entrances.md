# Skill entrances

The "entrance" of a skill is the surface where it becomes relevant and should be recommended: the user intents, phrasings, and contexts that route to it — and the sibling skills it must *not* steal from. This is the contract the router eval (`eval-set.json` + `router_eval.py`) measures each skill's `description` against.

Scope: the 14 skills that auto-trigger from natural language (now including `muggle-pr-followup`, which was made model-invocable). The `m*` short aliases and the remaining `disable-model-invocation` skill (`muggle-do`) fire only on explicit `/command` typing and are out of scope. `muggle-works-npm-release` is maintainer-only (relocated to `internal/`) and excluded.

The hardest routing lives at the boundaries between siblings; each entrance below names the neighbor it is most often confused with and the discriminator.

## muggle
**Engage when:** the user types bare `muggle` / `/muggle`, or asks what Muggle commands/options exist ("what can muggle do", "muggle help", "muggle menu"). Pure router/menu.
**Boundary:** any *specific* intent (test, status, upgrade…) should route straight to that skill, not the menu. The menu is the fallback only when intent is absent or genuinely ambiguous.

## muggle-test
**Engage when:** the user wants to E2E-acceptance-test **their recent code changes** — "test my changes", "validate my work before I push", "did my changes break anything", "regression test what I just did", "test on staging/preview". Change-driven: detect diff → map to use cases → run locally or remotely → publish + PR summary.
**Boundary vs `muggle-test-feature-local`:** that one targets *one named feature/flow on localhost* ("test the signup flow"); `muggle-test` is *change-driven* over the whole diff. When the user anchors on "my changes / my work / before push" → `muggle-test`. When they anchor on a *specific flow* or *localhost* → feature-local.
**Boundary vs `muggle-pr-visual-walkthrough`:** running the tests → `muggle-test`; only *posting existing results* to a PR → walkthrough.

## muggle-test-feature-local
**Engage when:** the user wants a real-browser E2E test of a **specific feature or user flow on localhost / a dev server** — "test the checkout flow on localhost:3000", "verify the new signup form works", "click through the onboarding and check it works". Feature-anchored, local.
**Boundary vs `muggle-test`:** see above — named flow/localhost vs whole-diff/before-push. Also fires for generic "test/validate this UI behavior" even without the word *muggle* or *E2E*.
**Boundary vs `muggle-browser-task`:** verifying a flow *works* → feature-local; *performing* a real action (actually post the tweet, actually submit the form) → browser-task.

## muggle-browser-task
**Engage when:** the user wants to **perform an action on a website** via natural language — "log into X and post this", "fill out this form on the site", "click through this flow and submit" — not implement code, not assert correctness.
**Boundary vs `muggle-test-feature-local`:** browser-task *does the thing*; feature-local *tests that the thing works*. Intent to accomplish a task ≠ intent to validate.

## muggle-test-import
**Engage when:** the user wants to bring **existing tests or test artifacts INTO Muggle** — Playwright/Cypress specs, Gherkin `.feature` files, a PRD, a test-plan doc, Notion export. "import my playwright tests", "migrate from cypress", "turn this PRD into muggle test cases", "track my specs in muggle".
**Boundary vs `muggle-test-regenerate-missing`:** import = *new* cases from an outside source; regenerate-missing = *existing* cases in the project that lack a script. **Boundary vs `none`:** importing a library/package into code (`import lodash`) is not this.

## muggle-test-regenerate-missing
**Engage when:** the user wants to **bulk-fill scripts for test cases that lack one** across a project — "regenerate missing scripts", "fill the gaps in my test scripts", "generate scripts for every case without one", "rebuild stale DRAFT cases".
**Boundary vs `muggle-test-import`:** no external source — operates on cases already in the project. **Boundary vs `muggle-test`:** project-wide script catch-up, not change-driven test execution.

## muggle-test-prepare
**Engage when:** the user needs **local dev servers / sibling services up before testing** — "are my services running", "spin up the dev servers", "get my local env ready for tests", "make sure localhost is up before we test". Also engaged *by* other muggle skills when ports aren't listening.
**Boundary vs `muggle-test*`:** preparation/environment readiness, not the test run itself.

## muggle-pr-visual-walkthrough
**Engage when:** the user wants to **post/attach existing E2E results to a PR** — "post the test results to the PR", "add the visual walkthrough", "share the E2E screenshots on the PR", "put the pass/fail summary on the PR".
**Boundary vs `muggle-test`:** purely the *publish-to-PR* step; assumes a run already happened.

## muggle-feedback
**Engage when:** the user wants to **flag what went wrong with a generated test/script or run** — "step 3 clicked the wrong button", "the test was wrong", "the summary is incorrect", "give feedback on this run", or pastes a Muggle dashboard URL to critique. Also view/delete prior feedback.
**Boundary vs `muggle-test`:** feedback is *after* a run, about quality; not a request to run anything.

## muggle-preferences
**Engage when:** the user wants to **view/set/reset Muggle config** — "show my muggle settings", "set autoLogin to always", "change muggle preference", "muggle config", "reset muggle preferences".
**Boundary vs `none`:** general tool config (prettier, eslint, git config) is not this — must be *Muggle* preferences.

## muggle-status
**Engage when:** the user wants a **health check of the Muggle install** — "muggle status", "is muggle healthy", "check MCP health", "is my auth still valid", "muggle isn't connecting, is it set up right".
**Boundary vs `muggle-repair`:** status *diagnoses/reports*; repair *fixes*. "Is it broken?" → status; "fix it" → repair. Ambiguous "muggle's acting up" leans status first (diagnose before fix).

## muggle-repair
**Engage when:** the user wants to **fix a broken Muggle install** — "muggle repair", "fix my muggle setup", "muggle MCP won't load, repair it", "reinstall/repair the muggle tooling".
**Boundary vs `muggle-status`:** explicit fix intent. **Boundary vs `none`:** fixing the user's *app* build is not this.

## muggle-upgrade
**Engage when:** the user wants to **update Muggle to the latest version** — "muggle upgrade", "update muggle", "get the latest muggle".
**Boundary vs `none`:** upgrading the user's npm deps / other tooling is not this.

## muggle-pr-followup
**Engage when:** the user wants **ongoing follow-up on a PR's review thread** — "watch my PR for review comments and address them", "keep an eye on PR #123 and respond to reviews as they come in", "follow up on my PR's reviews", "babysit this PR's review thread". It polls the PR for newly submitted reviews and hands them to `muggle-do`. Also: no args → auto-track every PR pushed this session; a PR URL → bootstrap a watcher on that PR.
**Boundary vs `muggle-do`:** the watcher only polls + dispatches; the classify/edit/reply/E2E work is `muggle-do`. **Boundary vs `muggle-pr-visual-walkthrough`:** watching a PR for incoming reviews ≠ posting test results to a PR. **Boundary vs `none`:** a one-off "review this PR" or "merge my PR" is not a standing watcher.
**Known limitation (accepted):** this skill competes with the platform's built-in `loop` skill, whose own examples ("poll for status", "keep running /babysit-prs") claim the "watch/poll/monitor a PR" phrasings. In the expanded eval it routed 6/24 — `loop` wins most of those head-to-head, and description tuning across two rewrites couldn't beat it (0→6→5). This is accepted: `loop` is a reasonable first hop that can itself run this skill, and explicit `/muggle:muggle-pr-followup` always works. Routing here is best-effort, not guaranteed.

## Explicit-invocation skills (command-only, out of auto-trigger scope)

`muggle-do` — the autonomous implement-to-PR executor (`muggle do` / the `address-reviews` directive) — carries `disable-model-invocation` and fires only when explicitly invoked, so it stays out of the auto-trigger eval.

`muggle-works-npm-release` (cutting a `@muggleai/works` npm release) is maintainer-only, relocated to `internal/` (PR #217) — not a customer-facing routing target.

## none (negative class)
Queries that share vocabulary with the above but must **not** route to any muggle skill: unit tests (jest/vitest), debugging a flaky CI test, reviewing a PR, importing a code library, upgrading app dependencies, configuring unrelated tools, checking infra/k8s health, fixing the app build, writing product release notes. These guard against keyword over-triggering.
