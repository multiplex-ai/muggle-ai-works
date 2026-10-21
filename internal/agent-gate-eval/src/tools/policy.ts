/**
 * The one policy every tool call in a run is decided by. The harness applies
 * it in a PreToolUse hook, which fires for every call that passes input
 * validation, and again in canUseTool as a backstop: canUseTool alone misses
 * the calls the SDK allows on its own, such as read-only Bash commands and
 * Reads inside the working directory.
 */

import type { PermissionResult, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";

import {
  HOST_STUB_PREFIX,
  LEGACY_AGENT_TOOL,
  MOCK_MCP_PREFIX,
  PRODUCTION_MUGGLE_PREFIX,
  SIMULATED_OUTPUT_PREFIX,
  STUBBED_BUILTIN_TOOL_NAMES,
  WRITE_TOOLS,
} from "../constants.js";
import { ScriptedTool, type ToolPolicyContext } from "../types.js";
import { isInsideDirectory, resolveSandboxPath } from "../sandbox/paths.js";

function deny(message: string): PermissionResult {
  return { behavior: "deny", message: message };
}

function decideFileTool(
  toolName: string,
  input: Record<string, unknown>,
  context: ToolPolicyContext,
): PermissionResult {
  const filePath = input.file_path;
  if (typeof filePath !== "string") return deny(`[harness] ${toolName} needs a file_path`);
  const target = resolveSandboxPath(filePath, context.paths);
  const isInSandbox = isInsideDirectory(context.paths.root, target);
  const isReadable = isInSandbox || isInsideDirectory(context.pluginRoot, target);
  const isWrite = WRITE_TOOLS.includes(toolName);
  if (isWrite ? isInSandbox : isReadable) {
    return { behavior: "allow", updatedInput: { ...input, file_path: target } };
  }
  if (isWrite) {
    return deny(
      `[harness] ${toolName} is limited to the sandbox at ${context.paths.root} (home ${context.paths.home}, repo ${context.paths.repo}); the plugin tree is read-only`,
    );
  }
  return deny(
    `[harness] Read is limited to the plugin tree at ${context.pluginRoot} and the sandbox at ${context.paths.root}; everything else in this environment is observed through the scripted Bash outputs`,
  );
}

/**
 * Decide one tool call.
 *
 * - Mock muggle and host-stub calls run (their handlers answer from the scenario).
 * - Bash and AskUserQuestion are denied with their scripted answer.
 * - Read runs inside the plugin tree or the sandbox; Write and Edit inside the
 *   sandbox only. A home path is redirected into the sandbox through `updatedInput`.
 * - A production muggle tool or a stubbed built-in is denied with a pointer to its stand-in.
 * - Anything else is denied.
 */
export function decideToolUse(
  toolName: string,
  input: Record<string, unknown>,
  context: ToolPolicyContext,
): PermissionResult {
  if (toolName.startsWith(MOCK_MCP_PREFIX) || toolName.startsWith(HOST_STUB_PREFIX)) {
    return { behavior: "allow", updatedInput: input };
  }
  if (toolName.startsWith(PRODUCTION_MUGGLE_PREFIX)) {
    const bareName = toolName.slice(PRODUCTION_MUGGLE_PREFIX.length);
    return deny(
      `[harness] the production muggle plugin is not available here — call \`${MOCK_MCP_PREFIX}${bareName}\` instead.`,
    );
  }
  if (toolName === ScriptedTool.AskUserQuestion) {
    return deny(context.answerQuestion(JSON.stringify(input)));
  }
  if (!context.builtinTools.includes(toolName)) {
    if (context.hasHostStubs && STUBBED_BUILTIN_TOOL_NAMES.has(toolName)) {
      const stubName = toolName === LEGACY_AGENT_TOOL ? ScriptedTool.Agent : toolName;
      return deny(`[harness] call \`${HOST_STUB_PREFIX}${stubName}\` instead of the built-in ${toolName}.`);
    }
    return deny(`[harness] tool ${toolName} is not available in this eval`);
  }
  if (toolName === "Bash") {
    return deny(`${SIMULATED_OUTPUT_PREFIX}${context.answerBash(String(input.command ?? ""))}`);
  }
  return decideFileTool(toolName, input, context);
}

/**
 * A policy decision as PreToolUse hook output. A hook's allow skips the SDK's
 * permission check, and its deny reason is what the model reads as the call's result.
 */
export function toPreToolUseOutput(decision: PermissionResult): SyncHookJSONOutput {
  if (decision.behavior === "allow") {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: decision.updatedInput,
      },
    };
  }
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: decision.message,
    },
  };
}
