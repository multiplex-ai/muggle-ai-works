#!/usr/bin/env bash

set -euo pipefail

# Injects the session context: when to reach for the muggle tools, the resolved
# preferences, the last-used project and host, and an upgrade notice. A SessionStart
# hook must answer inside the hook runtime budget, so the slow upkeep (the Electron
# runner install, the npm version lookup, state GC) runs detached in
# session-maintenance.sh and only its cached results are read here.

hook_dir="${BASH_SOURCE[0]%/*}"
[ "$hook_dir" = "${BASH_SOURCE[0]}" ] && hook_dir=.
. "${hook_dir}/guardrail-lib.sh"
guardrail_read_payload

# Refreshed on every start, so the inactivity sweep in gc-state.sh never collects
# a resumed session between its daily runs.
guardrail_resolve_state_file
if [ -f "$GUARDRAIL_STATE_FILE" ]; then
    touch "$GUARDRAIL_STATE_FILE" 2>/dev/null || true
fi

# The upkeep stamps the epoch second it next comes due, so a start inside that
# window launches nothing. Without EPOCHSECONDS (bash before 5) it always
# launches and the upkeep's own markers decide. Every stream is redirected so the
# harness sees this hook finish without waiting on it, and it runs at the lowest
# priority so its npm and install work never starves the hooks of the turn it
# overlaps.
upkeep_priority=""
command -v nice >/dev/null 2>&1 && upkeep_priority="nice -n 19"
maintenance_due_at=0
maintenance_stamp="${HOME}/.cache/muggle/session-maintenance-due"
if [ -f "$maintenance_stamp" ]; then
    read -r maintenance_due_at <"$maintenance_stamp" || true
fi
case "$maintenance_due_at" in ''|*[!0-9]*) maintenance_due_at=0 ;; esac
if [ -z "${EPOCHSECONDS:-}" ] || [ "$EPOCHSECONDS" -ge "$maintenance_due_at" ]; then
    ${upkeep_priority} bash "${hook_dir}/session-maintenance.sh" <<<"$GUARDRAIL_PAYLOAD" >/dev/null 2>&1 &
fi

escape_for_json() {
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\r'/\\r}"
    s="${s//$'\t'/\\t}"
    printf '%s' "$s"
}

# --- Upgrade notice ---
# session-maintenance.sh leaves "installed|latest" here only while latest is newer.
upgrade_notice=""
upgrade_available="${HOME}/.cache/muggle/upgrade-available"
if [ -f "$upgrade_available" ]; then
    installed_version=""
    latest_version=""
    IFS='|' read -r installed_version latest_version <"$upgrade_available" || true
    if [ -n "$installed_version" ] && [ -n "$latest_version" ]; then
        upgrade_notice="\n\nA newer @muggleai/works is available (${installed_version} → ${latest_version}). Tell the user to run \`/muggle:muggle-upgrade\` to update."
    fi
fi

# --- Preferences and last-used cache injection ---
# Preferences are user-level: defaults overlaid by the global file only. A legacy
# <cwd>/.muggle-ai/preferences.json is left on disk but no longer read, so the
# keys it can no longer apply are named once — the stamp file suppresses the
# repeat until that key set changes.
#
# The "last used Muggle Test project" and "last used local dev server URL"
# caches live in ~/.muggle-ai/, keyed by working directory, and are honored by
# skills when autoSelectProject / autoSelectLocalHost = always. A cache written
# before the move to the home directory still sits in <cwd>/.muggle-ai/ and is
# read as a fallback, so those sessions keep their context lines.
#
# Both are resolved in one node process, each section failing on its own.

# Defaults ship as data next to this hook so the context line and the MCP tools
# resolve a preference the same way. Hardcoding them here drifted once already.
prefs_defaults_file="${hook_dir}/../config/preference-defaults.json"
prefs_limits_file="${hook_dir}/../config/onboarding-limits.json"

onboarding_directive='Muggle Test first-run setup has not been run on this machine. Before acting on the user request, acknowledge what they asked for, then offer them the one-time setup walkthrough (the `onboard` operation of the muggle-preferences skill) which explains how Muggle Test works and saves their preferences. Accepting the recommended defaults takes one keystroke. If they decline, record the skip and carry on with their request using defaults.'

# A missing preferences file is not a special case: the resolver below falls back to
# the shipped defaults, which is exactly what the code will use until setup seeds them.
session_notes=""
session_notes=$(MUGGLE_PREFERENCE_DEFAULTS_FILE="$prefs_defaults_file" MUGGLE_ONBOARDING_LIMITS_FILE="$prefs_limits_file" MUGGLE_ONBOARDING_DIRECTIVE="$onboarding_directive" node -e "
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const cwd = process.env.CLAUDE_CWD || process.env.CURSOR_CWD || process.cwd();

    const preferenceNotes = () => {
      try {
        // Resolved through node, not the shell's \$HOME: under Git Bash the shell
        // reports a POSIX path that Windows node cannot open.
        const globalFile = path.join(os.homedir(), '.muggle-ai', 'preferences.json');
        let file = {};
        try { file = JSON.parse(fs.readFileSync(globalFile, 'utf-8')); } catch {}
        const g = file.preferences || {};
        let defaults = {};
        try { defaults = JSON.parse(fs.readFileSync(process.env.MUGGLE_PREFERENCE_DEFAULTS_FILE, 'utf-8')); } catch {}
        const resolved = { ...defaults, ...g };
        const line = Object.entries(resolved).map(([k,v]) => k+'='+v).join(' ');
        const blocks = ['Muggle Test Preferences (~/.muggle-ai/preferences.json):\\\\n' + line];

        const onboardedAt = file.onboardingCompletedAt;
        if (typeof onboardedAt !== 'string' || onboardedAt.length === 0) {
          // The offer is capped here rather than only in the skip path: a user who never
          // engages would otherwise be re-asked every session forever.
          let maxOffers = 0;
          try { maxOffers = JSON.parse(fs.readFileSync(process.env.MUGGLE_ONBOARDING_LIMITS_FILE, 'utf-8')).maxOffers; } catch {}
          const offersDir = path.join(os.homedir(), '.cache', 'muggle');
          const offersFile = path.join(offersDir, 'onboarding-offers');
          let offers = 0;
          try { offers = parseInt(fs.readFileSync(offersFile, 'utf-8'), 10) || 0; } catch {}
          if (maxOffers > 0 && offers < maxOffers) {
            try { fs.mkdirSync(offersDir, { recursive: true }); fs.writeFileSync(offersFile, String(offers + 1)); } catch {}
            blocks.push(process.env.MUGGLE_ONBOARDING_DIRECTIVE);
          }
        }

        const pPath = path.join(cwd, '.muggle-ai', 'preferences.json');
        let p = {};
        try { p = JSON.parse(fs.readFileSync(pPath, 'utf-8')).preferences || {}; } catch {}
        const inertKeys = Object.keys(p).filter((k) => p[k] !== resolved[k]).sort();
        if (inertKeys.length > 0) {
          const stampDir = path.join(os.homedir(), '.cache', 'muggle');
          const stampFile = path.join(stampDir, 'project-prefs-inert');
          const stamp = cwd + '|' + inertKeys.join(',');
          let lastStamp = '';
          try { lastStamp = fs.readFileSync(stampFile, 'utf-8'); } catch {}
          if (lastStamp !== stamp) {
            try { fs.mkdirSync(stampDir, { recursive: true }); fs.writeFileSync(stampFile, stamp); } catch {}
            blocks.push(
              'Muggle Test: per-project preferences were removed — ' + pPath + ' is no longer read, so these keys no longer take effect: ' + inertKeys.join(', ') + '.\\\\n' +
              'Tell the user to re-apply any they want everywhere with \`/muggle-preferences\`; the file is safe to delete.'
            );
          }
        }
        return '\\\\n\\\\n' + blocks.join('\\\\n\\\\n');
      } catch { return ''; }
    };

    const lastCacheNotes = () => {
      try {
        const parseFile = (filePath) => {
          try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return null; }
        };
        const readEntry = (fileName, legacyEntryKey) => {
          const home = parseFile(path.join(os.homedir(), '.muggle-ai', fileName));
          const homeEntry = home && home.entries && home.entries[path.resolve(cwd)];
          if (homeEntry) { return homeEntry; }
          const legacy = parseFile(path.join(cwd, '.muggle-ai', fileName));
          return (legacy && legacy[legacyEntryKey]) || null;
        };
        const lines = [];
        const lastProject = readEntry('last-project.json', 'lastProject');
        if (lastProject && lastProject.projectId) {
          const safeName = String(lastProject.projectName || '').replace(/\"/g, '\\\\\"');
          lines.push('Muggle Test Last Project: id=' + lastProject.projectId + ' url=' + lastProject.projectUrl + ' name=\"' + safeName + '\"');
        }
        const lastHost = readEntry('last-host.json', 'lastHost');
        if (lastHost && lastHost.host) {
          lines.push('Muggle Test Last Host: ' + lastHost.host);
        }
        return lines.map((line) => '\\\\n\\\\n' + line).join('');
      } catch { return ''; }
    };

    process.stdout.write(preferenceNotes() + lastCacheNotes());
  " 2>/dev/null || true)

# --- Host notes ---
# Codex runs this hook from its own manifest, which stamps MUGGLE_HOOK_HOST. The
# skills name Claude Code tools, and the CLAUDE_PLUGIN_ROOT their commands use is
# one Codex sets for hooks but never in the agent's own shell, so the agent is
# told both before it opens a skill.
host_notes=""
if [ "${MUGGLE_HOOK_HOST:-}" = "codex" ] && [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
  host_notes="

Muggle Test is running inside Codex, and its skills were written for Claude Code. Before following a Muggle skill, read ${CLAUDE_PLUGIN_ROOT}/skills/_shared/host-tool-equivalents.md. In short:
- A Muggle slash command such as /muggle:muggle-test or /muggle-do is the skill \$muggle:muggle-test or \$muggle:muggle-do.
- CLAUDE_PLUGIN_ROOT is not set in your shell. Where a skill runs \"\${CLAUDE_PLUGIN_ROOT}/scripts/...\", set it at the start of that same command: CLAUDE_PLUGIN_ROOT='${CLAUDE_PLUGIN_ROOT}'; ...
- Where a skill says AskUserQuestion, ask in your reply with numbered options and wait for the answer, or use request_user_input where it is offered."
fi

context="<EXTREMELY_IMPORTANT>\nYou have access to Muggle AI — a real-browser E2E acceptance testing tool.\n\nWhenever the user asks you to test, validate, verify, or check if their web app works — use the muggle MCP tools. This includes:\n- Testing user flows (signup, login, checkout, forms, dashboards)\n- Verifying UI changes didn't break anything\n- Running regression tests after code changes\n- Validating frontend behavior on localhost or a dev server\n- Checking if a feature works before merging a PR\n\nMuggle Test launches a real Electron browser that clicks buttons, fills forms, navigates pages, and captures screenshots. It generates replayable test scripts that persist across sessions.\n\nDo NOT write test code (Playwright, Cypress, Selenium) or try to test UI manually when muggle tools are available. Use the muggle skill or muggle MCP tools instead — they are faster, capture visual evidence, and produce reusable test scripts.\n\nTrigger phrases: 'test my app', 'check if it works', 'run E2E acceptance tests', 'validate the UI', 'verify the flow', 'regression test', 'make sure it still works', 'test before merging'.\n</EXTREMELY_IMPORTANT>${upgrade_notice}${session_notes}${host_notes}"

escaped_context=$(escape_for_json "$context")

if [ -n "${CURSOR_PLUGIN_ROOT:-}" ]; then
  printf '{\n  "additional_context": "%s"\n}\n' "$escaped_context"
elif [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
  printf '{\n  "hookSpecificOutput": {\n    "hookEventName": "SessionStart",\n    "additionalContext": "%s"\n  }\n}\n' "$escaped_context"
else
  printf '{\n  "additional_context": "%s"\n}\n' "$escaped_context"
fi

exit 0
