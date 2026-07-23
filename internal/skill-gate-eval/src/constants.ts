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

/** Default eval target — used when a skill leaves `model:` unset (inherits the session model). */
export const DEFAULT_MODEL = "claude-sonnet-4-6";

/**
 * Reps are isolated agent sessions sharing one subscription token, so the
 * ceiling is the token's rate budget, not CPU. 4 keeps a healthy sweep fast
 * while leaving headroom before the throttle gate starts firing.
 */
export const DEFAULT_GATE_EVAL_CONCURRENCY = 4;

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
