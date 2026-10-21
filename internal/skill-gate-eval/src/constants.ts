import { EvalHost } from "./types.js";

/** Tool name the agent SDK uses for its built-in user-prompt tool. */
export const ASK_QUESTION_TOOL = "AskUserQuestion";

/**
 * Per-scenario pass-rate floor. These are LLM behavioral gates, so a healthy
 * gate still misses occasionally (e.g. showElectronBrowser=never sits ~87% —
 * the model intermittently omits showUi instead of passing false). A 0.99 bar
 * demands perfection no prompt achieves and flakes every run; 0.8 still catches
 * a genuinely broken gate (which collapses well below it) while tolerating
 * normal variance. Raise GATE_RUNS for a tighter sample on borderline gates.
 */
export const PASS_THRESHOLD = 0.8;

/** Where each host's results land beside a gate's scenarios.json, so neither overwrites the other. */
export const RESULTS_FILENAME_BY_HOST: Record<EvalHost, string> = {
  [EvalHost.Claude]: "results.json",
  [EvalHost.Codex]: "results.codex.json",
};

/** Default eval target — used when a skill leaves `model:` unset (inherits the session model). */
export const DEFAULT_MODEL = "claude-sonnet-4-6";

/**
 * Reps are isolated agent sessions sharing one subscription token, so the
 * ceiling is the token's rate budget, not CPU. 8 halves a healthy sweep's wall
 * clock; the throttle gate absorbs the overshoot when the budget does bind,
 * pausing new starts pool-wide rather than failing the run.
 */
export const DEFAULT_GATE_EVAL_CONCURRENCY = 8;

export const THROTTLE_MAX_RETRIES = 3;
export const THROTTLE_BACKOFF_BASE_MS = 15_000;
export const THROTTLE_BACKOFF_CAP_MS = 120_000;
export const THROTTLE_BACKOFF_JITTER_MAX_MS = 5_000;

/** Map `/model`-style aliases (as used in SKILL.md `model:`) to concrete model ids. */
export const MODEL_ALIASES: Record<string, string> = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-8",
  fable: "claude-fable-5",
};

/**
 * The stdio mock's server name: the production one, so the host spells each
 * tool exactly as it would in a real session (Codex: `mcp__muggle__<tool>`).
 */
export const MOCK_STDIO_SERVER_NAME = "muggle";

/** Codex's own question tool — what plays AskUserQuestion's part where Codex offers it. */
export const CODEX_ASK_QUESTION_TOOL = "request_user_input";

/**
 * Questions a Codex run may answer by resuming its thread — the fallback when a
 * turn ends on a question rather than asking through the question tool. A run
 * that has not finished by then is judged as it stands, like one that reaches
 * the agent SDK harness's turn cap.
 */
export const CODEX_MAX_RESUMES = 8;

/** Ceiling on one `codex exec` turn, so a wedged session fails its rep instead of the suite. */
export const CODEX_TURN_TIMEOUT_MS = 10 * 60_000;

/** The file the Codex hook appends each tool call to, per rep. */
export const CODEX_GATE_TRACE_ENV = "MUGGLE_GATE_EVAL_TRACE";

/** The scenario's scripted answers, as a JSON file the Codex hook reads. */
export const CODEX_GATE_ANSWERS_ENV = "MUGGLE_GATE_EVAL_ANSWERS";

/** First line of every config.toml an eval's Codex harness writes; each refuses to overwrite one without it. */
export const CODEX_EVAL_HOME_MARKER = "# Written by a muggle eval harness, which owns this directory.";

/**
 * Codex tools no eval offers — neither agent SDK harness has an equivalent —
 * switched off so the model is not handed them. What they leave besides the
 * eval's own tools (Codex's MCP-resource tools, apply_patch) the hooks deny.
 */
export const CODEX_UNUSED_FEATURES = ["view_image", "multi_agent", "image_generation", "goals"];
