/** Flags of `muggle watch tick`. */
export interface WatchTickFlags {
  /** Commander's `--no-auto-reload` negation: false stops a plugin change from starting a reload fan-out. */
  autoReload: boolean;
  /** Commander's `--no-recovery` negation: false reports dead watchers without resuming their owners. */
  recovery: boolean;
  /** Print the full snapshot as JSON instead of a summary line. */
  json?: boolean;
}

/** Flags of `muggle watch status`. */
export interface WatchStatusFlags {
  /** Print the stored snapshot as JSON. */
  json?: boolean;
}

/** Flags of `muggle watch reload-plugins`. */
export interface WatchReloadPluginsFlags {
  /** Show what each session would get without respawning anything. */
  dryRun?: boolean;
  /** Print the report as JSON. */
  json?: boolean;
}

/** Flags of `muggle watch register` and `muggle watch unregister`. */
export interface WatchSlotFlags {
  /** The PR-watch slot dir, e.g. `~/.muggle-ai/muggle-do/sessions/<slug>`. */
  slot: string;
}
