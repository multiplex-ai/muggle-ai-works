/** What a repository's walkthrough workflow is, relative to the renderings Muggle has shipped. */
export enum InstalledWorkflowState {
  Missing = "missing",
  /** Byte-identical, line endings aside, to the current rendering. */
  Current = "current",
  /** An earlier release's rendering, never edited — Muggle's own file to replace. */
  Outdated = "outdated",
  /** Matches no rendering Muggle shipped: the consumer edited it, so it is theirs. */
  Customized = "customized",
}
