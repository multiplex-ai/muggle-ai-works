import { localQa } from "@muggleai/mcp";

/**
 * Parse the `--priority` option the local Studio commands take.
 *
 * @param rawPriority - The option as typed; absent leaves the run's class to the default.
 * @returns The class, or undefined when the option was not given.
 * @throws Error when the value names no class.
 */
export function parseStudioJobPriorityOption(rawPriority: string | undefined): localQa.StudioJobPriorityEnum | undefined {
  if (rawPriority === undefined) {
    return undefined;
  }
  const priorityClasses = Object.values(localQa.StudioJobPriorityEnum) as string[];
  if (!priorityClasses.includes(rawPriority)) {
    throw new Error(`--priority must be one of ${priorityClasses.join(", ")}, got '${rawPriority}'.`);
  }
  return rawPriority as localQa.StudioJobPriorityEnum;
}
