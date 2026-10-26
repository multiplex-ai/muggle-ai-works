---
name: muggle-upgrade
model: haiku
description: Update Muggle AI to the newest version on its current release lane. Use when user types muggle upgrade or asks to update Muggle Test tools.
---

# Muggle Test Upgrade

> Telemetry first step: see [`_shared/telemetry-emit.md`](../_shared/telemetry-emit.md). Use `skillName: "muggle-upgrade"`.

> Running outside Claude Code (in Codex, for one)? Read [`../_shared/host-tool-equivalents.md`](../_shared/host-tool-equivalents.md) first — it maps the tools and paths this skill names to your host's.

Update all Muggle AI components to the newest version **on the release lane the machine is already on**. This means **both** the `@muggleai/works` CLI on npm **and** the Electron runner the CLI manages.

## Release lanes

Two lanes ship on npm, each with its own dist-tag:

| Lane | dist-tag | Version shape |
| :--- | :------- | :------------ |
| stable | `latest` | `5.15.0` |
| staging | `staging` | `5.16.0-staging.109` |

**The lane is read off the installed build, never chosen by this skill.** A version carrying a prerelease identifier is on staging; a plain release is on stable. Stable is the default, and a machine that has never installed a prerelease stays there.

**Upgrade within the lane, and compare against that lane's tag.** Semver orders `5.15.0-staging.106` *below* `5.15.0`, so a staging build measured against `latest` looks out of date — that comparison silently moves a staging user onto stable and takes away the lane they were testing on. It is the specific bug this section exists to prevent.

**Switch lanes only when the user asks in this invocation** — "switch to stable", "go back to prod", "put me on staging", or naming an explicit version to install. A bare invocation always keeps the lane it found. When the user does name a version, install exactly that and say which lane it lands on.

## Steps

1. Run `/muggle:muggle-status` checks to capture current versions.

2. Capture the installed CLI and resolve its lane:
   - Installed CLI: `muggle --version`
   - Published heads of both lanes: `npm view @muggleai/works dist-tags --json`
   - Detect install location: `npm ls -g @muggleai/works --depth=0` (falls back to `pnpm ls -g @muggleai/works` if not found)

   Read the lane off the installed version per the table above, then take that lane's tag as the upgrade target. Do not compare across lanes.

3. **If the installed CLI is behind its own lane's tag**, upgrade the CLI before touching Electron. Install the **tag**, not a version string, so the lane keeps resolving on later runs:
   - stable, npm: `npm install -g @muggleai/works@latest` — pnpm: `pnpm add -g @muggleai/works@latest`
   - staging, npm: `npm install -g @muggleai/works@staging` — pnpm: `pnpm add -g @muggleai/works@staging`
   - Already at the lane's tag → report "already current" and continue to step 4.
   - If neither package manager is detected, report the situation and ask the user how the CLI was installed before proceeding.

4. Run `muggle upgrade` to pull the Electron runner version the (now-current) CLI expects.
   - Note: `muggle upgrade` only manages the Electron runner — it does NOT upgrade the CLI npm package. That is why step 3 must run first.
   - The runner tracks published Studio releases only. When it reports "already on the latest version", that is the newest *released* runner — code merged to the Studio repo since that release is not in it, and no upgrade command can reach it until a new runner is published. Say so rather than implying the merge shipped.

5. **Muggle Watch** — gate: [`autoInstallWatchService`](../muggle-preferences/preference-gates/autoInstallWatchService.md). Step 3's postinstall already acted on `always` and `never`, so print their silent footer. On `ask`, run Picker 1; on `Install it`, run `muggle watch install` and report its last line.

6. **Reload plugins** — the global npm install (step 3) runs a postinstall script that points Claude Code's `muggle-works` marketplace at the installed package, so the plugin loads from the version just installed — but Claude Code only picks up new skills/agents/hooks after a reload. With Muggle Watch installed, idle background sessions are restarted onto the new build within a few minutes; this session and other terminal sessions still need a reload by hand. Tell the user:

   > Run **`/reload-plugins`** to load the updated skills, agents, and hooks.

   Wait for the user to confirm they've reloaded before proceeding.

7. Run `/muggle:muggle-status` again to confirm everything is healthy after upgrade.

## Output

Show a before/after table for **CLI**, **Electron runner**, **MCP server**, and **Auth**, and name the lane beside the CLI version so it is visible that it did not move. Call out any version that did not change so the user understands what shipped vs what was already current.

If any component upgraded, always end with the `/reload-plugins` reminder — even if the user doesn't need new features right away, stale cached skills can cause confusing behavior.

If the upgrade fails at any step, report the error and suggest running `/muggle:muggle-repair`.

## Preferences

| Preference | Gate |
| :--------- | :--- |
| `autoInstallWatchService` | Step 5 — run Muggle Watch as a scheduled job on any OS; postinstall acts on `always`/`never`, `ask` asks here, default `ask` |
