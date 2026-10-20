/** One server-sent event of a Responses API stream, as Codex parses it. */
export type ResponseStreamEvent = Record<string, unknown>;

/** One item of a model request's `input`: a message, a function call, its output. */
export interface ModelInputItem {
  type: string;
  role?: string;
  content?: Array<{ type: string; text?: string }>;
  name?: string;
  namespace?: string;
  call_id?: string;
  arguments?: string;
  output?: unknown;
}

/** A tool a model request offers: a function, or a namespace of them (how Codex sends MCP tools). */
export interface ModelTool {
  type: string;
  name: string;
  tools?: ModelTool[];
}

/** The body Codex POSTs to `/responses`. */
export interface ModelRequest {
  model: string;
  input: ModelInputItem[];
  tools?: ModelTool[];
}

/** Decides the scripted model's reply to the request it is handed (zero-based within the run). */
export type ScriptedTurn = (request: ModelRequest, requestIndex: number) => ResponseStreamEvent[];

/** What one `codex exec` run left behind. */
export interface CodexExecResult {
  status: number | null;
  stdout: string;
  stderr: string;
  requests: ModelRequest[];
}

/** A JSON-RPC response from `codex app-server`. */
export interface AppServerResponse {
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

/** What one `codex app-server` exchange returned, with the server's own log. */
export interface AppServerSession {
  responses: AppServerResponse[];
  log: string;
}
