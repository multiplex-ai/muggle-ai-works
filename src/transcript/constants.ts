/** The entry type every user-role line carries, typed prompts and tool results alike. */
export const USER_ENTRY_TYPE = "user";

/** The origin kind Claude Code stamps on a prompt the person typed or queued. */
export const HUMAN_ORIGIN_KIND = "human";

/** A content part holding prose rather than a tool result or an image. */
export const TEXT_CONTENT_PART_TYPE = "text";

/** A content part carrying a tool's output back to the model. */
export const TOOL_RESULT_CONTENT_PART_TYPE = "tool_result";
