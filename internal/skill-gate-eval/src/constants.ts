/** Tool name the agent SDK uses for its built-in user-prompt tool. */
export const ASK_QUESTION_TOOL = "AskUserQuestion";

/** Per-scenario pass-rate floor below which we treat the gate as misfiring. */
export const PASS_THRESHOLD = 0.99;

/** Default eval target — used when a skill leaves `model:` unset (inherits the session model). */
export const DEFAULT_MODEL = "claude-sonnet-4-6";

/** Map `/model`-style aliases (as used in SKILL.md `model:`) to concrete model ids. */
export const MODEL_ALIASES: Record<string, string> = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-8",
  fable: "claude-fable-5",
};
