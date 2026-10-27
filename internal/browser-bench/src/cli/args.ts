import { DEFAULT_CONCURRENCY, MAX_STEPS_PER_TASK } from "../domain/constants";
import { ModelSource } from "../domain/types";
import { CliFlag, type BenchmarkCliOptions } from "./types";

const readFlagValue = (argv: string[], flagIndex: number): string => {
  const value = argv[flagIndex + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${argv[flagIndex]} needs a value.`);
  }
  return value;
};

const readInteger = (argv: string[], flagIndex: number): number => {
  const rawValue = readFlagValue(argv, flagIndex);
  const parsedValue = Number(rawValue);
  if (!Number.isInteger(parsedValue)) {
    throw new Error(`${argv[flagIndex]} needs a whole number, got "${rawValue}".`);
  }
  return parsedValue;
};

const readPositiveInteger = (argv: string[], flagIndex: number): number => {
  const rawValue = readFlagValue(argv, flagIndex);
  const parsedValue = Number(rawValue);
  if (!Number.isInteger(parsedValue) || parsedValue < 1) {
    throw new Error(`${argv[flagIndex]} needs a positive whole number, got "${rawValue}".`);
  }
  return parsedValue;
};

const readModelSource = (argv: string[], flagIndex: number): ModelSource => {
  const rawValue = readFlagValue(argv, flagIndex);
  const modelSource = Object.values(ModelSource).find((source) => source === rawValue);
  if (modelSource === undefined) {
    throw new Error(
      `${argv[flagIndex]} must be one of ${Object.values(ModelSource).join(", ")}, got "${rawValue}".`,
    );
  }
  return modelSource;
};

/**
 * Resolves command-line arguments into one run's configuration.
 *
 * Path defaults are injected rather than read here, so the parser stays pure
 * and the caller owns where the tool's own files live.
 *
 * Output shape: `{ tasksPath: "…/webvoyager-smoke.jsonl", taskLimit: 5,
 * concurrency: 2, outDir: "…/reports", resume: false }`
 *
 * @throws When a flag is unrecognised, missing its value, or given a
 * non-positive count.
 */
export const parseCliArgs = ({
  argv,
  defaultTasksPath,
  defaultOutDir,
}: {
  argv: string[];
  defaultTasksPath: string;
  defaultOutDir: string;
}): BenchmarkCliOptions => {
  const options: BenchmarkCliOptions = {
    tasksPath: defaultTasksPath,
    concurrency: DEFAULT_CONCURRENCY,
    outDir: defaultOutDir,
    resume: false,
    maxSteps: MAX_STEPS_PER_TASK,
  };

  let index = 0;
  while (index < argv.length) {
    const flag = argv[index];

    if (flag === CliFlag.Resume) {
      options.resume = true;
      index += 1;
      continue;
    }

    switch (flag) {
      case CliFlag.Tasks:
        options.tasksPath = readFlagValue(argv, index);
        break;
      case CliFlag.Out:
        options.outDir = readFlagValue(argv, index);
        break;
      case CliFlag.Limit:
        options.taskLimit = readPositiveInteger(argv, index);
        break;
      case CliFlag.Concurrency:
        options.concurrency = readPositiveInteger(argv, index);
        break;
      case CliFlag.MaxSteps:
        options.maxSteps = readPositiveInteger(argv, index);
        break;
      case CliFlag.SampleSize:
        options.sampleSize = readPositiveInteger(argv, index);
        break;
      case CliFlag.SampleSeed:
        options.sampleSeed = readInteger(argv, index);
        break;
      case CliFlag.ModelSource:
        options.modelSource = readModelSource(argv, index);
        break;
      default:
        throw new Error(`Unknown flag ${flag}. Accepted: ${Object.values(CliFlag).join(", ")}.`);
    }

    index += 2;
  }

  // A sample without a seed cannot be regenerated, which makes the score it
  // produces impossible to check. Refuse rather than invent a seed.
  if ((options.sampleSize === undefined) !== (options.sampleSeed === undefined)) {
    throw new Error(
      `${CliFlag.SampleSize} and ${CliFlag.SampleSeed} must be given together — ` +
        `a sample drawn without a recorded seed cannot be reproduced.`,
    );
  }

  return options;
};
