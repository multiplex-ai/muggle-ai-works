/**
 * Raised when a caller's wait for the execution lane ran out while another
 * checkout still held it. Nothing was launched: this is a scheduling outcome,
 * never a test result.
 */

import type { ILaneBusyDetails } from "./local-execution-lock-types.js";

/** The lane stayed held by another checkout for the whole wait the caller allowed. */
export class LocalExecutionLaneBusyError extends Error {
  readonly busy: ILaneBusyDetails;
  readonly waitedMs: number;

  constructor(params: { busy: ILaneBusyDetails; waitedMs: number }) {
    const holder = params.busy.holderCwd ?? "a checkout ahead in line";
    super(`Local execution lane is busy: held by ${holder}; this checkout is #${params.busy.position} in line`);
    this.name = "LocalExecutionLaneBusyError";
    this.busy = params.busy;
    this.waitedMs = params.waitedMs;
  }
}
