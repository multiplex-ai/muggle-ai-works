#!/usr/bin/env node

// PreToolUse hook the Codex routing eval installs in its own CODEX_HOME: appends
// every tool call Codex is about to make to the file MUGGLE_ROUTE_TRACE names,
// one JSON line each, and lets the call through. A hook sees the call whatever
// form the model made it in — a direct function call or one nested in Codex's
// code mode, which `codex exec --json` does not report.

import { appendFileSync, readFileSync } from "node:fs";

function readHookPayload() {
    try {
        return JSON.parse(readFileSync(0, "utf-8"));
    } catch {
        return {};
    }
}

const tracePath = process.env.MUGGLE_ROUTE_TRACE;
const payload = readHookPayload();
if (tracePath && typeof payload.tool_name === "string") {
    const line = { type: "muggle.route_trace", tool_name: payload.tool_name, tool_input: payload.tool_input ?? {} };
    appendFileSync(tracePath, `${JSON.stringify(line)}\n`);
}
process.stdout.write("{}");
