import { z } from "zod";

/**
 * Per-run override of a test case lane's fan-out policy across its runSettings records.
 * It applies to one Run test request and is never saved to a test spec.
 */
export enum FanOutChoice {
  FollowPolicy = "followPolicy",
  PrimaryOnly = "primaryOnly",
  AllNow = "allNow",
}

/**
 * Optional `fanOutChoice` field of the Run test requests. Omitting it keeps it off the wire,
 * which the backend treats as `followPolicy`.
 */
export const FanOutChoiceInputSchema = z
  .enum([FanOutChoice.FollowPolicy, FanOutChoice.PrimaryOnly, FanOutChoice.AllNow])
  .optional()
  .describe(
    "Optional: followPolicy (default) runs each test case's runSettings records per its lane's fan-out policy; primaryOnly runs only the primary record; allNow runs every record at once",
  );
