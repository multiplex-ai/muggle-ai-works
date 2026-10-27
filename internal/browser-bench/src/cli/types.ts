import { type ModelSource } from "../domain/types";

/** Flags `run.ts` accepts on the command line. */
export enum CliFlag {
  Tasks = "--tasks",
  Limit = "--limit",
  Concurrency = "--concurrency",
  Out = "--out",
  Resume = "--resume",
  MaxSteps = "--max-steps",
  SampleSize = "--sample-size",
  SampleSeed = "--sample-seed",
  ModelSource = "--model-source",
}

/** One benchmark run's configuration, with every default already resolved. */
export interface BenchmarkCliOptions {
  tasksPath: string;
  /** Absent means run the whole task file. */
  taskLimit?: number;
  concurrency: number;
  outDir: string;
  resume: boolean;
  /** Steps an agent may take per task. Defaults to WebVoyager's own cap. */
  maxSteps: number;
  /** Absent means run the task file as given, with no sampling. */
  sampleSize?: number;
  /** Selects the draw. Required whenever `sampleSize` is set, so a slice is always reproducible. */
  sampleSeed?: number;
  /** Absent means studio picks its own default source. */
  modelSource?: ModelSource;
}
