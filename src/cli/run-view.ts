/**
 * `muggle run-view` CLI handler.
 *
 * Shows what a local run actually did — its steps beside the frames they produced — so the run's
 * own verdict can be read against its own evidence. Terminal output is the default; `--html`
 * renders a self-contained page, because frames are the point and a terminal cannot show them.
 */

import {
  openBrowserUrl,
  readRunView,
  renderRunViewText,
  RunViewError,
  writeRunViewHtml,
} from "@muggleai/mcp";

/** Options accepted by `muggle run-view`. */
export interface IRunViewCommandOptions {
  /** Render a self-contained HTML page instead of terminal text. */
  html?: boolean;

  /** Open the rendered page in the default browser; implies --html. */
  open?: boolean;

  /** Directory to write the page into; defaults to the working directory. */
  outDir?: string;
}

/**
 * Render one run for a person.
 * @param runId - Full or partial run id; omitted takes the newest run.
 * @param options - Rendering options.
 */
export async function runViewCommand(
  runId: string | undefined,
  options: IRunViewCommandOptions = {},
): Promise<void> {
  let runView;
  try {
    runView = readRunView(runId);
  } catch (error) {
    if (error instanceof RunViewError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  if (!options.html && !options.open) {
    console.log(renderRunViewText(runView, { includeHtmlOffer: true }));
    return;
  }

  const htmlPath = writeRunViewHtml(runView, options.outDir);
  console.log(renderRunViewText(runView, { includeHtmlOffer: false }));
  console.log(`\nWrote ${htmlPath}`);

  if (options.open) {
    const opened = await openBrowserUrl({ url: `file://${htmlPath.replace(/\\/g, "/")}` });
    if (!opened.opened) {
      console.log("Could not open a browser automatically — open the file above.");
    }
  }
}
