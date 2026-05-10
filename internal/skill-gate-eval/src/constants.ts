/** Tool name the agent SDK uses for its built-in user-prompt tool. */
export const ASK_QUESTION_TOOL = "AskUserQuestion";

/** Per-scenario pass-rate floor below which we treat the gate as misfiring. */
export const PASS_THRESHOLD = 0.99;

/** Default eval target until the suite is stable enough to add others. */
export const DEFAULT_MODEL = "claude-sonnet-4-6";
