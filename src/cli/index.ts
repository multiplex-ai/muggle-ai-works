/**
 * CLI entry point for @muggleai/works.
 *
 * Runtime command wiring is implemented in the commands package so it can be
 * reused across app entrypoints and tested at package boundaries.
 */
export { runCli } from "../../packages/commands/src/index.js";
