/**
 * How long a busy claim's suggested background wait keeps this checkout in line before it gives up.
 * Bounded so a wait whose session died leaves the line on its own; a live session re-arms it.
 */
export const STACK_WAIT_SECONDS = 1800;
