import { StudioVerdict } from "../../local/types/enums.js";

/** Human label for each Studio verdict on a run's `**Studio Verdict:**` line. */
export const STUDIO_VERDICT_LABELS: Record<StudioVerdict, string> = {
  [StudioVerdict.Success]: "Passed",
  [StudioVerdict.BugDetected]: "Bug Detected",
  [StudioVerdict.GoalNotAchievable]: "Goal Not Achievable",
  [StudioVerdict.GoalUnachievable]: "Goal Not Achievable",
  [StudioVerdict.Failure]: "Failed",
  [StudioVerdict.Failed]: "Failed",
  [StudioVerdict.Timeout]: "Timed Out",
  [StudioVerdict.InsufficientBalance]: "Insufficient Balance",
};

/** The lifecycle status every recorded action script carries, on failed runs and passed ones alike. */
export const RECORDED_SCRIPT_LIFECYCLE_STATUS = "active";
