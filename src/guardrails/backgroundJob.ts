import { spawn } from "child_process";
import { GuardrailBackgroundJob } from "./types.js";

/** Whether `subcommand` names a background job rather than a hook gate. */
export function isBackgroundJob(subcommand: string | undefined): subcommand is GuardrailBackgroundJob {
  return Object.values(GuardrailBackgroundJob).includes(subcommand as GuardrailBackgroundJob);
}

/**
 * Starts `job` in a detached run of this CLI that outlives the hook, so the hook answers without waiting on it.
 * Best effort, like the `gh` calls the job makes: a spawn that fails leaves the work undone and the hook unaffected.
 * @param jobArgs - The job's arguments, after its name.
 * @param cwd - Where the job runs; the walkthrough scan resolves the working branch's PR from it.
 */
export function startBackgroundJob(job: GuardrailBackgroundJob, jobArgs: string[], cwd?: string): void {
  try {
    // execArgv carries a loader such as tsx, so a CLI run from source starts its jobs the same way.
    const child = spawn(process.execPath, [...process.execArgv, process.argv[1], job, ...jobArgs], {
      cwd: cwd,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    return;
  }
}
