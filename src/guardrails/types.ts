export interface GuardrailState {
  sessionId: string;
  prsHandled: string[];
  unitTestsGreen?: boolean;
  e2eRun?: boolean;
  e2eBlockCount?: number;
  buildIntentRouted?: boolean;
}

export interface HookInput {
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: { command?: string };
  tool_response?: { stdout?: string; stderr?: string; output?: string };
  prompt?: string;
}
