import { AgentDocResourceUri } from "./types.js";
import type { IAgentDocResource } from "./types.js";

/** npm name of the package whose root holds the served doc files. */
export const WORKS_PACKAGE_NAME = "@muggleai/works";

/** Agent docs served as MCP resources, read from the installed package. */
export const AGENT_DOC_RESOURCES: readonly IAgentDocResource[] = [
  {
    uri: AgentDocResourceUri.Agents,
    name: "agents",
    title: "Muggle Works agent guide (AGENTS.md)",
    description: "How an AI coding agent installs, signs in to and uses Muggle Works: local and cloud flows, skills, pricing, results, common errors.",
    mimeType: "text/markdown",
    packageRelativePath: "AGENTS.md",
  },
  {
    uri: AgentDocResourceUri.Llms,
    name: "llms",
    title: "Muggle Works llms.txt",
    description: "llmstxt.org index of the Muggle Works docs and key skill files.",
    mimeType: "text/plain",
    packageRelativePath: "llms.txt",
  },
];
