/**
 * Same-named in-process stand-ins for the orchestration tools a skill drives
 * (HOST_STUB_SPECS). The SDK runs the built-ins without consulting canUseTool,
 * so each is served from an MCP server instead; a call answers from the
 * scenario's `toolResponses` and nothing runs.
 */

import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";

import { EVAL_MCP_SERVER_VERSION, HOST_STUB_SERVER_NAME, HOST_STUB_SPECS } from "../constants.js";
import type { ScriptedTool } from "../types.js";

/**
 * Build the host-stub server for one run.
 *
 * @param answer - The run's scripted-tool answerer, given the tool and its JSON-serialized input.
 */
export function buildHostStubServer(
  answer: (tool: ScriptedTool, serializedInput: string) => string,
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: HOST_STUB_SERVER_NAME,
    version: EVAL_MCP_SERVER_VERSION,
    tools: HOST_STUB_SPECS.map((spec) =>
      tool(spec.tool, spec.description, spec.shape, async (args) => ({
        content: [{ type: "text" as const, text: answer(spec.tool, JSON.stringify(args)) }],
      })),
    ),
  });
}
