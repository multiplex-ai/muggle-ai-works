# Critical Paths and Skill Coverage

Maps each task a user performs with Muggle Works to what serves it, and ranks what is missing. Checked against `origin/master` at `e7d213c`. The customer version, without gaps, is `getting-started/critical-tasks.md` in `muggle-ai-docs`.

## Coverage Levels

| Level | Meaning |
| :---- | :------ |
| Skill | A skill runs the task end to end |
| CLI | A `muggle` command runs the task |
| Partial | A skill or command covers part of the task |
| MCP only | Tools exist, but no skill guides the user; the agent must improvise |
| Dashboard | Handled in the web dashboard, so no skill is owed |
| None | Nothing serves the task |

## Task Map

| # | Phase | Task | Served by | Coverage |
| :- | :---- | :--- | :-------- | :------- |
| 1 | Install | Install the plugin or MCP server | Install pages, `/plugin install` | CLI |
| 2 | Install | Save preferences, offer the CI check | `muggle init` | CLI |
| 3 | Install | Sign in | `muggle login`, automatic on first protected call | CLI |
| 4 | Install | Confirm the install is healthy | `/mstatus`, `muggle doctor` | Skill |
| 5 | Project | Create a project and seed it from the live site | `muggle-remote-workflow-start-website-scan`, `-start-test-case-detection`, `-use-case-candidates-approve` | MCP only |
| 6 | Project | Seed from existing tests or PRDs | `/mimport` | Skill |
| 7 | Project | Store test credentials and roles | `muggle-remote-secret-*`, `muggle-remote-test-role-*` | MCP only |
| 8 | Project | Set up test chaining | `muggle-remote-test-chaining-*`, `muggle-remote-test-state-*` | MCP only |
| 9 | Test | Start local services | `/mtestprep`, `muggle stack` | Skill |
| 10 | Test | Test recent changes | `/mtest` | Skill |
| 11 | Test | Test one flow on localhost | `/mtestlocal` | Skill |
| 12 | Test | Run the whole suite on demand | `muggle-remote-workflow-start-test-script-replay-bulk` | MCP only |
| 13 | Build | Take a request to a pull request | `/mdo` | Skill |
| 14 | Pull request | Post the walkthrough | `/mpr` | Skill |
| 15 | Pull request | Handle reviews, CI, and base drift | `/mprfollowup`, `muggle watch` | Skill |
| 16 | Pull request | Require the walkthrough in CI | `muggle ci-install` | CLI |
| 17 | Automate | Run on a schedule | `muggle-remote-recommend-schedule` | MCP only |
| 18 | Automate | Run from CI with an API key | `muggle-remote-auth-api-key-*`, `muggle-remote-recommend-cicd-setup` | MCP only |
| 19 | Maintain tests | Flag a wrong script or step | `/mfeedback` | Skill |
| 20 | Maintain tests | Generate missing scripts | `/mregen` | Skill |
| 21 | Maintain tests | Regenerate stale scripts in bulk | Per case through failure handling | Partial |
| 22 | Maintain tests | Edit, delete, or approve test cases | `muggle-remote-test-case-*`, `muggle-remote-use-case-*` | MCP only |
| 23 | Review | See results history and cost | `muggle run-view` for one local run; `muggle-remote-report-*` otherwise | Partial |
| 24 | Account | Top up the wallet, set auto top-up | `muggle-remote-wallet-*` | MCP only |
| 25 | Account | Invite teammates | Organization → Members | Dashboard |
| 26 | Operate | Change preferences | `/mprefs` | Skill |
| 27 | Operate | Repair a broken install | `/mrepair` | Skill |
| 28 | Operate | Upgrade or change release lane | `/mupgrade` | Skill |
| 29 | Operate | Switch environment | README only | None |
| 30 | Operate | Remove Muggle from a machine or repository | `/plugin uninstall`; no repository removal | Partial |

## Missing Skills and Commands

Ranked by how early the gap stops a user. Names are proposals.

| Rank | Proposal | Tasks | Gap |
| :--- | :------- | :---- | :-- |
| 1 | `muggle-project-setup` skill | 5 | A new user with no tests has no guided path from a URL to a seeded project; `/mimport` needs existing artifacts |
| 2 | `muggle-credentials` skill | 7 | Login-gated flows need stored credentials, yet skills only read the secret list |
| 3 | `muggle-regression` skill | 12 | `/mtest` is change-driven, so nothing runs the full suite before a release |
| 4 | `muggle-schedule` skill, or `muggle ci-install --replay` | 17, 18 | `ci-install` adds only the PR walkthrough check, with no API key and no scheduled run |
| 5 | Extend `/mregen` to stale scripts | 21 | It skips `ACTIVE` cases although its description promises stale ones, so after a UI change the user repairs case by case |
| 6 | `muggle-results` skill | 23 | No history, trend, or cost view outside the dashboard |
| 7 | `muggle-test-curate` skill | 22 | Scan candidates cannot be approved through a skill, and edits happen only inside repair |
| 8 | `muggle-billing` skill | 24 | An empty wallet stops org runs, and nothing guides the top-up |
| 9 | `muggle-chaining` skill | 8 | Skills read the test plan graph but never configure it |
| 10 | `muggle uninstall`, `muggle env` commands | 29, 30 | Removal from a repository and environment switching are manual |

## Unreferenced Tools

64 of 126 MCP tools are referenced by no file under `plugin/`, counting exact names only. Most are the tools behind tasks 5, 7, 8, 12, 17, 22, 23, and 24.

## Limits

Coverage comes from reading skills and the CLI. No task was run, an agent can still call any tool ad hoc, and only customer docs were checked for dashboard coverage. Ranks are judgment, not usage data.
