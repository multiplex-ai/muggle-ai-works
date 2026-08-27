/** The judge model. Vision-capable, and the strongest available — a weak judge caps the benchmark's own accuracy. */
export const JUDGE_MODEL = "claude-opus-5";

/**
 * Output budget for one verdict. Thinking is on by default on this model and
 * shares the budget with the reply, so a tight cap truncates the verdict line
 * rather than the reasoning.
 */
export const JUDGE_MAX_TOKENS = 16_000;

/** Maps a screenshot's extension to the media type the image block declares. */
export const JUDGE_IMAGE_MEDIA_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/** Names the credential the judge needs; the batch refuses to start without it. */
export const JUDGE_API_KEY_ENV_VAR = "ANTHROPIC_API_KEY";

/** Studio writes the judge's input manifest here, inside each task's trajectory directory. */
export const TRAJECTORY_MANIFEST_FILENAME = "trajectory.json";
