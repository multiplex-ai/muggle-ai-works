/**
 * How a project's test case runs start across its resolutions. The string values are the backend's
 * `FanOutPolicyEnum`, sent as the project's `fanOutPolicy`.
 */
export enum RunStrategy {
  /** Only the primary resolution runs; the compatible resolutions are reported as not run. */
  PrimaryOnly = "primaryOnly",
  /** The primary resolution runs first; the compatible resolutions run once it passes. */
  PrimaryFirst = "primaryFirst",
  /** Every resolution runs at once. */
  AllAtOnce = "allAtOnce",
}
