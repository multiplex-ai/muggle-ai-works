/** Flags of `muggle checkout-freshness`. */
export interface CheckoutFreshnessFlags {
  /** Directory inside the checkout to check; the current directory when omitted. */
  cwd?: string;
  /** Branch the change merges into; origin's default branch when omitted. */
  base?: string;
  /** Commander's `--no-fetch` negation: false checks against the last fetched base. */
  fetch: boolean;
  /** Print the full report as JSON instead of a summary. */
  json?: boolean;
}
