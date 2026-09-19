/**
 * Browser sizing types for local runs.
 */

/**
 * Webview dimensions the electron-app reads from `actionParams.displayParams`.
 * Field names match what the studio destructures, so this is a wire shape — do
 * not rename without changing the electron-app side.
 */
export interface DisplayParams {
  /** Webview width in CSS pixels. */
  browserWindowWidth: number;
  /** Webview height in CSS pixels. */
  browserWindowHeight: number;
}
