# Host Tool Equivalents

These skills are written against Claude Code's tools. In another agent host — Codex in particular — read each Claude Code name below as the equivalent in the host you are running in. Everything the skills do through the muggle MCP tools, the `muggle` CLI, `gh`/`glab`, and the shell works the same in every host; only the names in this table change.

| The skill says | In Claude Code | In Codex |
| :------------- | :------------- | :------- |
| `/muggle:<skill>` or a short alias (`/mtest`, `/muggle-do`) | A slash command | The skill `$muggle:<skill>` — for example `$muggle:muggle-test`. The user can also pick it from `/skills`. |
| Invoke a skill "via the `Skill` tool" | The `Skill` tool | Open that skill's `SKILL.md` — every skill is listed with its path — and follow it. |
| `AskUserQuestion` | Clickable options | `request_user_input` where Codex offers it. Otherwise end your turn on the question, with the options numbered, and treat the user's reply as their pick. Never pick for them. |
| `${CLAUDE_PLUGIN_ROOT}` in a command | Set wherever a command runs | Set for hooks only, never in your shell. Set it at the start of the same command that uses it: `CLAUDE_PLUGIN_ROOT='<plugin root>'; bash "${CLAUDE_PLUGIN_ROOT}/scripts/sign-body.sh" …`. The plugin root is the directory that holds this `skills/` folder. Prefixing the variable to the command name alone (`CLAUDE_PLUGIN_ROOT=… bash "${CLAUDE_PLUGIN_ROOT}/…"`) does not work: the shell expands the path before the assignment applies. |
| `$CLAUDE_CODE_SESSION_ID` | This session's id | `$CODEX_SESSION_ID` — the same id the hooks receive as `session_id`. |
| Dispatch a plugin agent (`agents/*.md`, subagent type `muggle:<agent>`) | The Agent tool | `spawn_agent` with that agent file's instructions as the task, when multi-agent is enabled; otherwise run the agent file inline, as each skill already allows for a host with no subagents. |
| `TodoWrite` | The session task list | `update_plan` |
| `Monitor`, `/loop`, `CronCreate`/`CronDelete` (the PR watcher's background watch) | Wake the session when the watch reports an event | No equivalent: nothing in Codex wakes a session from a background process. Run the drain tick, seed the slot without a loop (`pr-watch-arm.sh … --no-exec`), and tell the user that following the PR up means invoking `$muggle:muggle-pr-followup` again — or scheduling it with `codex exec`. Never leave a loop polling that no session will hear. |
| `model:` in a skill's frontmatter | Runs the skill on that model | Ignored — the session's model runs every skill. |

## Codex's sandbox

Codex runs your shell commands in a sandbox that, by default, blocks the network and writes outside the workspace. The muggle MCP tools are not affected — they run outside it — but `gh`, `glab`, and writes under `~/.muggle-ai/` (session state, PR-watch slots) are. When one of those commands is refused, ask for it to run with escalated permissions rather than working around it. A user who wants fewer prompts can allow the network and that directory in `~/.codex/config.toml`:

```toml
[sandbox_workspace_write]
network_access = true
writable_roots = ["/absolute/path/to/home/.muggle-ai"]
```

Codex also strips variables whose names contain `KEY`, `SECRET`, or `TOKEN` from your shell, so a `gh` that authenticates through `GH_TOKEN` alone sees no token there; `gh auth login` stores one `gh` can read without it.
