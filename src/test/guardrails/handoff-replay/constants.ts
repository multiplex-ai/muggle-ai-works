import { join } from "path";
import { PLUGIN_ROOT } from "../footprint/constants.js";
import { PLUGIN_SCRIPTS_DIR } from "../support/constants.js";
import { HandoffStep, HandoffStopGate } from "./types.js";

/** The session id every replay runs as. */
export const HANDOFF_SESSION_ID = "mdo-handoff-replay";

/** The feature the replayed session is asked to build. */
export const HANDOFF_BUILD_REQUEST = "add a CSV export to the reports page";

/** The forward request, typed the way a user invokes muggle-do. */
export const HANDOFF_BUILD_PROMPT = `/mdo ${HANDOFF_BUILD_REQUEST}`;

/** The skill the replayed session runs. */
export const MUGGLE_DO_SKILL_NAME = "muggle-do";

/** This checkout's skills tree, which the skill-stage hooks resolve declarations against. */
export const PLUGIN_SKILLS_ROOT = join(PLUGIN_ROOT, "skills");

/** The arm script the Stage 8 watch monitor runs. */
export const PR_WATCH_ARM_SCRIPT = join(PLUGIN_SCRIPTS_DIR, "pr-watch-arm.sh");

/** The repository the replayed PR is opened against. */
export const HANDOFF_REPO_SLUG = "acme/reports";

/** The replayed PR's number. */
export const HANDOFF_PR_NUMBER = 342;

/** The replayed PR's url, as `gh pr create` prints it. */
export const HANDOFF_PR_URL = `https://github.com/${HANDOFF_REPO_SLUG}/pull/${HANDOFF_PR_NUMBER}`;

/** The PR's title, shared by its creation command and its watch monitor's label. */
export const HANDOFF_PR_TITLE = "feat: CSV export for reports";

/** The head commit the replayed PR was opened at. */
export const HANDOFF_HEAD_SHA = "4f2a9c1e7b3d5a6c8e9f0a1b2c3d4e5f6a7b8c9d";

/** The branch the replayed PR targets. */
export const HANDOFF_BASE_BRANCH = "main";

/** The muggle-do session slot Stage 8 seeds for the PR. */
export const HANDOFF_SLOT_SLUG = `reports-pr${HANDOFF_PR_NUMBER}`;

/**
 * The forward run's stage files, relative to plugin/skills, in the order muggle-do opens them: input routing,
 * stages 1 through 7.5, then the Stage 8 hand-off and the arming procedure it follows.
 */
export const FORWARD_STAGE_FILES = [
  "do/input-routing.md",
  "do/pre-flight.md",
  "do/requirements.md",
  "do/build.md",
  "do/impact-analysis.md",
  "do/unit-tests.md",
  "do/e2e-acceptance.md",
  "do/open-prs.md",
  "do/open-prs/forward.md",
  "do/e2e-repair.md",
  "muggle-pr-followup/SKILL.md",
  "muggle-pr-followup/arm-watcher.md",
] as const;

/** The telemetry emit muggle-do makes as its first step, as Claude Code names the plugin's MCP tool. */
export const MUGGLE_TELEMETRY_SKILL_EMIT_TOOL = "mcp__plugin_muggle_muggle__muggle-local-telemetry-skill-emit";

/** What the telemetry emit answers. */
export const TELEMETRY_EMIT_RESULT = "recorded";

/** The local replay execution Stage 6 runs, as Claude Code names the plugin's MCP tool. */
export const MUGGLE_EXECUTE_REPLAY_TOOL = "mcp__plugin_muggle_muggle__muggle-local-execute-replay";

/** The test script Stage 6 replays. */
export const E2E_TEST_SCRIPT_ID = "ts-csv-export";

/** The dev server Stage 6 replays against. */
export const E2E_LOCAL_URL = "http://localhost:3000";

/** Stage 5's unit-test command. */
export const UNIT_TEST_COMMAND = "pnpm test";

/** A passing vitest summary. */
export const UNIT_TEST_OUTPUT = " Test Files  3 passed (3)\n      Tests  41 passed (41)\n";

/** The run summary a passing local execution prints. */
export const E2E_RUN_RESULT = "**Run ID:** run-csv-export-1\n**Status:** passed\n**Steps:** 9/9";

/** A skip declaration citing a fact the fixture repo bears out: it ships no web surface. */
export const NO_WEB_SURFACE_SKIP_DECLARATION =
  "MUGGLE_E2E_SKIP: NO_WEB_SURFACE: CLI-only package with no browser surface to drive";

/** A package with no web-server script, no browser framework, and no framework config file. */
export const NO_WEB_SURFACE_MANIFEST = {
  name: "reports-cli",
  version: "1.0.0",
  type: "module",
  scripts: { test: "vitest run" },
  devDependencies: { vitest: "^3.2.0" },
};

/** Stage 7's PR creation, with a plain description that carries no report. */
export const PR_CREATE_COMMAND =
  `gh pr create --title "${HANDOFF_PR_TITLE}" --body "Adds a CSV export to the reports page." --base ${HANDOFF_BASE_BRANCH}`;

/** Where the rendered walkthrough is written in the repo before it is posted. */
export const WALKTHROUGH_BODY_FILE = ".muggle/walkthrough.md";

/** A `muggle build-pr-section` rendering: the sentinel the walkthrough recorder keys on, and its results. */
export const WALKTHROUGH_BODY = "<!-- muggle-pr-section:v1 -->\n## E2E Acceptance Results\n\n**✅ PASS** — 2 tests ran\n";

/** The walkthrough post, reading the rendered body from the repo. */
export const WALKTHROUGH_POST_COMMAND = `gh pr comment ${HANDOFF_PR_NUMBER} --body-file ${WALKTHROUGH_BODY_FILE}`;

/** The posted comment's url, as `gh pr comment` prints it. */
export const WALKTHROUGH_COMMENT_URL = `${HANDOFF_PR_URL}#issuecomment-1`;

/** The PR content the stubbed provider reports to the walkthrough probe: a description, and no walkthrough anywhere. */
export const PR_CONTENT_WITHOUT_WALKTHROUGH = JSON.stringify({
  body: "Adds a CSV export to the reports page.",
  comments: [],
});

/** The arm script's drain report for an open PR with nothing outstanding. */
export const WATCH_ARM_OUTPUT =
  `DRAIN pr=${HANDOFF_PR_NUMBER} state=OPEN head=${HANDOFF_HEAD_SHA.slice(0, 8)}\n` +
  "DRAIN unresolved-threads=0 latest-review=0 latest-comment=0\n" +
  "DRAIN checks pending=2 failed=0 behind-base=0 mergeable=MERGEABLE\n" +
  `ARMED pr=${HANDOFF_PR_NUMBER} watermark seeded at watch-watermark.env\n`;

/** The watermark the arm script seeds from a drain that found nothing outstanding. */
export const WATCH_WATERMARK = 'REV=0\nCOM=0\nTHREADS=""\nCIRED=""\nREBASED=""\nBLOCKED_CIDIGEST=""\n';

/** The PID lease the started watch loop writes. */
export const WATCH_LOOP_PID = "4242\n";

/** The file a running watch loop touches every poll; its mtime is the watch's liveness. */
export const WATCH_HEARTBEAT_FILE = "watch-heartbeat";

/** The monitor timeout the arming procedure gives the watch, in milliseconds. */
export const WATCH_MONITOR_TIMEOUT_MS = 1_800_000;

/** The turn's closing message, claiming nothing a Stop gate objects to. */
export const HANDOFF_CLOSING_MESSAGE =
  `Opened ${HANDOFF_PR_URL} with the E2E walkthrough posted, and its watcher is armed.`;

/** The full handoff, in the order muggle-do runs it. */
export const FULL_HANDOFF_SEQUENCE: readonly HandoffStep[] = [
  HandoffStep.BuildRequest,
  HandoffStep.SkillInvocation,
  HandoffStep.StageReads,
  HandoffStep.UnitTests,
  HandoffStep.E2eExecution,
  HandoffStep.PrCreation,
  HandoffStep.WalkthroughPost,
  HandoffStep.WatcherHandoff,
];

/**
 * The skip marker each gate's block names as its way out. It is the gate's documented escape hatch, so it stays
 * stable while the surrounding wording changes.
 */
export const STOP_GATE_SKIP_MARKERS: Record<HandoffStopGate, string> = {
  [HandoffStopGate.E2e]: "MUGGLE_E2E_SKIP",
  [HandoffStopGate.Walkthrough]: "MUGGLE_WALKTHROUGH_SKIP",
  [HandoffStopGate.Watch]: "MUGGLE_WATCH_SKIP",
};

/** Gates that decide on a provider lookup, which only a POSIX `gh` stub can answer. */
export const PROVIDER_DEPENDENT_STOP_GATES: readonly HandoffStopGate[] = [HandoffStopGate.Walkthrough];

/** Ceiling for replaying the steps every case shares, about twenty CLI spawns. */
export const SHARED_REPLAY_TIMEOUT_MS = 120_000;

/** Ceiling for one case: its remaining steps, the Stop gates, and waiting out a provider scan. */
export const HANDOFF_CASE_TIMEOUT_MS = 90_000;

/** How long a blocking gate may take to decide, covering the walkthrough gate's detached provider scan. */
export const GATE_SETTLE_TIMEOUT_MS = 30_000;

/** How often an undecided gate is fired again while its scan lands. */
export const GATE_SETTLE_POLL_MS = 250;
