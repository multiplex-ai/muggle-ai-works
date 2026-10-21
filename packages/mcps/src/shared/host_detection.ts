/**
 * Best-effort detection of which MCP host the muggle client is running inside.
 *
 * An MCP config Muggle ships stamps its host outright in MUGGLE_MCP_HOST, and
 * that stamp wins. Without one, MCP hosts control their own environment, so
 * detection is heuristic: each known host is identified by environment-variable
 * signals that we have observed empirically; none of these are documented
 * contracts and the Cursor signal in particular is weak. Codex launches MCP
 * servers with a scrubbed environment (HOME, PATH, the locale and little else),
 * so it is recognised only by the stamp its shipped config sets. If no signal
 * matches, we return "unknown" rather than guess — the design's operational
 * mitigation is to monitor the "unknown" host share on dashboards and treat
 * a step change as a regression.
 *
 * The returned value is attached to every outbound backend HTTP call as the
 * X-Client-Host header by PromptServiceClient.buildHeaders.
 */

export type McpHost = "claude-code" | "cursor" | "codex" | "windsurf" | "unknown";

/** Environment variable an MCP config sets to name its host outright. */
export const MCP_HOST_ENV_VAR = "MUGGLE_MCP_HOST";

/** The hosts a config may stamp; anything else in the variable is ignored. */
const STAMPABLE_MCP_HOSTS: readonly McpHost[] = ["claude-code", "cursor", "codex", "windsurf"];

/**
 * Detect the MCP host from its explicit stamp, else from process.env signals.
 * First match wins. Returns "unknown" if nothing matches.
 */
export function detectMcpHost(env: NodeJS.ProcessEnv = process.env): McpHost {
    const stampedHost = STAMPABLE_MCP_HOSTS.find(
        (host) => host === env[MCP_HOST_ENV_VAR]?.trim().toLowerCase(),
    );
    if (stampedHost) {
        return stampedHost;
    }

    // Claude Code: the CLI sets CLAUDE_CODE or leaves a CLAUDECODE_* variant.
    // Either pattern is a strong signal.
    if (env.CLAUDE_CODE || env.CLAUDECODE || env.CLAUDE_CODE_SSE_PORT) {
        return "claude-code";
    }

    // Cursor: observed to set CURSOR_TRACE_ID on MCP subprocesses. Not a
    // documented contract but stable across recent versions.
    if (env.CURSOR_TRACE_ID || env.CURSOR_MCP) {
        return "cursor";
    }

    // Codex: these reach the server only when a hand-written config passes them
    // through; the plugin's own config stamps MUGGLE_MCP_HOST instead.
    if (env.CODEX || env.OPENAI_CODEX) {
        return "codex";
    }

    // Windsurf: sets WINDSURF_MCP or uses Codeium branding via CODEIUM_API_KEY.
    if (env.WINDSURF_MCP || env.WINDSURF || env.CODEIUM_API_KEY) {
        return "windsurf";
    }

    return "unknown";
}
