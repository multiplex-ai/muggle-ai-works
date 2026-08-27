/** The `task.json` the harness writes for studio to read. */
export interface StudioTaskFile {
  taskId: string;
  instruction: string;
  startUrl: string;
  maxSteps: number;
  trajectoryDir: string;
  /**
   * Where studio writes its result. Carried in the task rather than as a second
   * command-line flag: where a task's result goes is part of the task, and
   * neither could be passed without the other.
   */
  outputFilePath: string;
}

/** The `result.json` studio writes when an attempt completes. */
export interface StudioResultFile {
  taskId: string;
  finalAnswer: string;
  studioStatus: string;
  stepCount: number;
  durationMs: number;
  trajectoryDir: string;
}

/** Everything one studio process needs to attempt one task. */
export interface StudioInvocation {
  studioBinPath: string;
  /** Studio's positional auth file, carrying the user profile it identifies the run by. */
  authFilePath: string;
  taskFilePath: string;
  resultFilePath: string;
  browserProfileDir: string;
}

/** How a studio process ended. `exitCode` is null when a signal killed it. */
export interface StudioExitReport {
  exitCode: number | null;
  stderrTail: string;
}

/** A live studio process the runner can await or kill. */
export interface StudioProcess {
  exitReport: Promise<StudioExitReport>;
  kill: () => void;
}

/** Starts one studio process. Injected so tests never launch a real binary. */
export type SpawnStudio = (invocation: StudioInvocation) => StudioProcess;

/** The disk access one task attempt needs, injected so tests stay off the filesystem. */
export interface TaskFileSystem {
  /** Deletes `dirPath` and its contents, then recreates it empty. */
  recreateDirAsync: (dirPath: string) => Promise<void>;
  writeTextAsync: (filePath: string, content: string) => Promise<void>;
  readTextAsync: (filePath: string) => Promise<string>;
}

/** The local muggle session on disk, as written by `muggle login`. */
export interface MuggleSession {
  userId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

/** Studio's `UserProfile`, supplied as the positional auth file. */
export interface StudioUserProfile {
  userId: string;
  nickname: string;
  email: string;
  sessionId: string;
  firebaseSessionToken: string;
  accessToken: string;
}
