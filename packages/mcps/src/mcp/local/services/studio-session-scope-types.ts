/** Where a Studio run stands with its session, as Studio prints it on stdout. */
export enum StudioSessionScopeStateEnum {
  /** Another run holds the session; this run waits for it before its browser opens. */
  Waiting = "waiting",
  /** The run holds its session and goes on. */
  Acquired = "acquired",
}

/** Told each session state Studio prints, in order. */
export type StudioSessionScopeStateListener = (sessionScopeState: StudioSessionScopeStateEnum) => void;
