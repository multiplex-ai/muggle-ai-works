/** Why the MCP asked a running local execution to stop. */
export enum RunStopReasonEnum {
  /** The run outlived its time limit. */
  Timeout = "timeout",
  /** The user cancelled the run. */
  Cancelled = "cancelled",
}

/** The slice of a child process the stop request acts on. */
export interface IStoppableProcess {
  /** Null while the process is still running. */
  exitCode: number | null;
  /** Null while the process has not been killed by a signal. */
  signalCode: NodeJS.Signals | null;
  kill: (signal?: NodeJS.Signals) => boolean;
}
