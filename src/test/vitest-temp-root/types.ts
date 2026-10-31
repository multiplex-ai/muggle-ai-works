declare module "vitest" {
  /** Context the global setup hands every test worker. */
  export interface ProvidedContext {
    /** Per-run temp root every worker points its temp-dir env vars at. */
    runTempRoot: string;
  }
}

export {};
