export interface GuardrailState {
  sessionId: string;
  prsHandled: string[];
  unitTestsGreen?: boolean;
  e2eRun?: boolean;
  e2eSkipped?: boolean;
  e2eBlockCount?: number;
  buildIntentRouted?: boolean;
  terminalPending?: number[];
  terminalHandled?: number[];
  terminalBlockCount?: number;
}

export enum PrTerminalVerdict {
  Merged = "merged",
  Closed = "closed",
}

export interface PrTerminalEvent {
  prNumber: number;
  verdict: PrTerminalVerdict;
}

export enum PrTerminalGateAction {
  Block = "block",
  Release = "release",
  None = "none",
}

export interface PrTerminalGateDecision {
  action: PrTerminalGateAction;
  blockCount: number;
}

export interface HookInput {
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: { command?: string };
  tool_response?: { stdout?: string; stderr?: string; output?: string; content?: string };
  prompt?: string;
}
