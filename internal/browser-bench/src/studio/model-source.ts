import { ModelSource } from "../domain/types";
import { STUDIO_MODEL_SOURCE_ENV_VAR, STUDIO_USER_API_KEY_ENV_VAR } from "./constants";

/**
 * The environment one studio process runs with: the harness's own, plus the batch's model source
 * when it names one. Without a source the variable is left exactly as inherited.
 *
 * Output shape: `{ …process.env, MUGGLE_LLM_PROVIDER: "claude-code" }`
 */
export const buildStudioEnv = ({
  baseEnv,
  modelSource,
}: {
  baseEnv: NodeJS.ProcessEnv;
  modelSource?: ModelSource;
}): NodeJS.ProcessEnv =>
  modelSource === undefined
    ? { ...baseEnv }
    : { ...baseEnv, [STUDIO_MODEL_SOURCE_ENV_VAR]: modelSource };

/**
 * Refuses a batch whose source cannot be measured honestly. The API side of a source comparison
 * runs on the operator's own key: without one, studio falls back to Muggle's embedded key, which is
 * never used for measurement.
 *
 * @throws When `modelSource` is `anthropic` and `MUGGLE_LLM_API_KEY` is unset.
 */
export const assertModelSourceUsable = ({
  env,
  modelSource,
}: {
  env: NodeJS.ProcessEnv;
  modelSource?: ModelSource;
}): void => {
  if (modelSource === ModelSource.Anthropic && !env[STUDIO_USER_API_KEY_ENV_VAR]) {
    throw new Error(
      `--model-source ${ModelSource.Anthropic} measures the API on your own key, but ` +
        `${STUDIO_USER_API_KEY_ENV_VAR} is unset. Export it before running the batch.`,
    );
  }
};

/**
 * Confirms studio ran on the source the batch configured. A studio build that ignores the variable,
 * or predates source reporting, would otherwise pass one source's results off as another's.
 *
 * @throws When a source was configured and studio reported a different one, or none.
 */
export const assertStudioRanOnSource = ({
  taskId,
  configuredSource,
  reportedSource,
}: {
  taskId: string;
  configuredSource?: ModelSource;
  reportedSource?: string;
}): void => {
  if (configuredSource === undefined || reportedSource === configuredSource) return;
  throw new Error(
    `Studio ran task ${taskId} on model source ${reportedSource ?? "(not reported)"} but the batch ` +
      `configured ${configuredSource}; the attempt cannot count toward that source.`,
  );
};
