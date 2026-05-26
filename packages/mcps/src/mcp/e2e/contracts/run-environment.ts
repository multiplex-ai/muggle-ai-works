import { z } from "zod";

/**
 * Environment lane a test run belongs to. The cloud versions runSettings (and
 * thus credentials) per `(projectId, type)` lane: a `local` run resolves the
 * developer's localhost credentials instead of the remote managed-profile pool,
 * which a dev tenant rejects.
 */
export enum RunEnvironment {
  Local = "local",
  Remote = "remote",
}

export const RunEnvironmentSchema = z.enum([RunEnvironment.Local, RunEnvironment.Remote]);

/**
 * Lane field shared by generation/replay/upload contracts. Optional with no
 * default so omitting it stays omitted on the wire — the backend treats a
 * missing `type` as remote, which keeps pre-lane behavior unchanged.
 */
export const RunEnvironmentInputSchema = RunEnvironmentSchema.optional().describe(
  "Environment lane for the run: 'local' (developer localhost) or 'remote' (deployed). " +
    "Selects which versioned runSettings/credentials lane the cloud resolves. Omit for remote (default).",
);
