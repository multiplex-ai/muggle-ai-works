/** Process count from `ps -u <user> -o pid=` output: one non-blank line each. */
export function countProcessListLines(psOutput: string): number {
  return psOutput.split("\n").filter((line) => line.trim() !== "").length;
}

/**
 * RLIMIT_NPROC counts every process of the user, not the guarded subtree, so
 * the rlimit backends cap at current-count + limit. Headroom semantics: other
 * processes the user starts or stops after launch shift the effective room for
 * the tree — looser than the cgroup / Job Object per-tree caps.
 */
export function computeNprocCeiling(args: {
  currentUserProcessCount: number;
  activeProcessLimit: number;
}): number {
  return args.currentUserProcessCount + args.activeProcessLimit;
}
