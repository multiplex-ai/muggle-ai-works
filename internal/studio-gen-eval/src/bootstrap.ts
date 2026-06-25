// Imported before @muggleai/mcp so its eager config load succeeds. Run from
// source, that package resolves its config from packages/mcps (which carries no
// muggleConfig) rather than the repo root; pinning the runtime target skips that
// lookup. Defaults to the live backend; export the var yourself to point elsewhere.
process.env.MUGGLE_MCP_PROMPT_SERVICE_TARGET ??= "production";
