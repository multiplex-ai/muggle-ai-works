/** Knobs of the agent-gate eval's Codex harness (codex-harness.ts) and its hook. */

/** The file the Codex hook appends each tool call to, per rep. */
export const CODEX_AGENT_TRACE_ENV = "MUGGLE_AGENT_EVAL_TRACE";

/** The scenario's scripted shell outputs, as a JSON file the Codex hook reads. */
export const CODEX_AGENT_BASH_ENV = "MUGGLE_AGENT_EVAL_BASH";

/** The plugin tree, whose files a shell read may really open — the agent SDK harness's Read scope. */
export const CODEX_AGENT_READ_ROOT_ENV = "MUGGLE_AGENT_EVAL_READ_ROOT";

/** Codex's own question tool — what plays AskUserQuestion's part, which no agent may call. */
export const CODEX_ASK_QUESTION_TOOL = "request_user_input";

/** The sandbox a rep's real plugin reads run in; every other command is scripted and never runs. */
export const DEFAULT_CODEX_AGENT_SANDBOX = "read-only";
