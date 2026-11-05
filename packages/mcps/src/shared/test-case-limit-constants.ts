/** Agent-facing rule for where a test's limits live, stated on every tool that writes or runs a test case. */
export const TEST_CASE_LIMIT_GUIDANCE =
  "Anything the test must or must not touch, including which target and which path, goes in the test case's stored description before the run. A limit stated only in chat with the coding agent does not reach the run.";

/** Agent-facing warning on the tools that can regenerate a use case's test cases. */
export const USE_CASE_REGENERATION_WARNING =
  "Regeneration replaces the use case's test cases, which drops the limits stored in their descriptions; store them again afterwards.";
