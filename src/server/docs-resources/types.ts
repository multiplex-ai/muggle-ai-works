/** URIs of the agent docs the MCP server serves as resources. */
export enum AgentDocResourceUri {
  Agents = "muggle://docs/agents",
  Llms = "muggle://docs/llms",
}

/** A resource as resources/list advertises it. */
export interface IListedAgentDocResource {
  uri: AgentDocResourceUri;
  name: string;
  title: string;
  description: string;
  mimeType: string;
}

/** A packaged doc file served as an MCP resource. */
export interface IAgentDocResource extends IListedAgentDocResource {
  /** File path relative to the `@muggleai/works` package root. */
  packageRelativePath: string;
}

/** A text resource body as resources/read returns it. */
export interface IAgentDocResourceContents {
  uri: AgentDocResourceUri;
  mimeType: string;
  text: string;
}
