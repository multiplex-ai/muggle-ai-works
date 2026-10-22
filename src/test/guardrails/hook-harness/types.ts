/** One run of the guardrails CLI: the HOME it sees, its arguments, and the payload on stdin. */
export interface GuardrailCliInvocation {
  home: string;
  cliArgs: string[];
  stdin: string;
  /** Base environment, `process.env` when omitted; HOME and USERPROFILE are always set on top of it. */
  env?: NodeJS.ProcessEnv;
}

/** How one CLI run exited and what it printed, trimmed. */
export interface GuardrailCliRun {
  status: number | null;
  stdout: string;
}

/** What the walkthrough-probe `gh` stub answers to the walkthrough gate's provider reads. */
export interface WalkthroughProbeAnswers {
  /** The working branch's PR url, or "" for a branch with none. */
  branchPrUrl: string;
  /** The JSON printed for `gh pr view <url> --json body,comments`. */
  prContentJson: string;
}
