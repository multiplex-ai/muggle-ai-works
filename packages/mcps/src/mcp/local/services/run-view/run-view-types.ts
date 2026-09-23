/**
 * One step of a run, paired with the frame it produced.
 */
export interface IRunViewStep {
  /** Zero-based position in the action script. */
  index: number;

  /** Operation the agent performed, e.g. "navigate", "click", "captureInfo". */
  action: string;

  /** The agent's own one-line account of why it took this step. */
  explanation: string;

  /** Absolute path to this step's screenshot, or null when the run recorded none. */
  screenshotPath: string | null;

  /** Target of a navigate step, when the operation carried one. */
  url: string | null;
}

/**
 * A run as the viewer presents it: what the agent did, beside what it concluded.
 */
export interface IRunView {
  /** Run id, as named by its session directory. */
  runId: string;

  /** Absolute path to the session directory the run was read from. */
  sessionPath: string;

  /** Test case title the run was generated or replayed for, when recorded. */
  title: string | null;

  /**
   * Outcome the run storage recorded, or null when it recorded none. Deliberately not the action
   * script's own `status` field, which describes the script and reads "active" for a failed run.
   */
  status: string | null;

  /** The run's closing verdict — the claim the steps below should be read against. */
  verdict: string | null;

  /** Steps in execution order. */
  steps: IRunViewStep[];

  /** How many screenshots the session holds, which exceeds the step count. */
  screenshotCount: number;
}
