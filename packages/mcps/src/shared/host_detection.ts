/**
 * Best-effort detection of which MCP host the muggle client is running inside.
 *
 * MCP hosts control their own environment, so detection is inherently
 * heuristic. Each known host is identified by environment-variable signals
 * that we have observed empirically; none of these are documented contracts
 * and the Cursor and Codex signals in particular are weak. If no signal
 * matches, we return "unknown" rather than guess — the design's operational
 * mitigation is to monitor the "unknown" host share on dashboards and treat
 * a step change as a regression.
 *
 * The returned value is attached to every outbound backend HTTP call as the
 * X-Client-Host header by PromptServiceClient.buildHeaders.
 */

export type McpHost = "claude-code" | "cursor" | "codex" | "windsurf" | "unknown";

/**
 * Detect the MCP host by inspecting process.env for host-specific signals.
 * First match wins. Returns "unknown" if nothing matches.
 */
export function detectMcpHost(env: NodeJS.ProcessEnv = process.env): McpHost {
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

    // Codex: weaker signal. The CLI is still in limited preview and the env
    // contract may change. Require BOTH an OpenAI key AND a Codex-specific
    // hint to avoid false positives from any shell that happens to export
    // OPENAI_API_KEY.
    if (env.CODEX || env.OPENAI_CODEX) {
        return "codex";
    }

    // Windsurf: sets WINDSURF_MCP or uses Codeium branding via CODEIUM_API_KEY.
    if (env.WINDSURF_MCP || env.WINDSURF || env.CODEIUM_API_KEY) {
        return "windsurf";
    }

    return "unknown";
}
