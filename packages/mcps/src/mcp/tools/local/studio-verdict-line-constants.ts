import { StudioVerdict } from "../../local/types/enums.js";

/** Human label for each Studio verdict on a run's `**Studio Verdict:**` line. */
export const STUDIO_VERDICT_LABELS: Record<StudioVerdict, string> = {
  [StudioVerdict.Success]: "Passed",
  [StudioVerdict.Active]: "Passed",
  [StudioVerdict.BugDetected]: "Bug Detected",
  [StudioVerdict.GoalNotAchievable]: "Goal Not Achievable",
  [StudioVerdict.Failure]: "Failed",
  [StudioVerdict.Failed]: "Failed",
  [StudioVerdict.Timeout]: "Timed Out",
};
