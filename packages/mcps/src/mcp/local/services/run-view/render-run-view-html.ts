import * as fs from "node:fs";
import * as path from "node:path";

import type { IRunView, IRunViewStep } from "./run-view-types.js";

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Inline a frame as a data URI.
 *
 * The page has to survive being sent to someone — attached to a PR, dropped in a chat — and a
 * page referencing local .jpg paths does not. A frame that cannot be read is skipped rather than
 * failing the render: a partial view of a broken run still answers the question being asked of it.
 */
const inlineFrame = (screenshotPath: string | null): string | null => {
  if (!screenshotPath || !fs.existsSync(screenshotPath)) {
    return null;
  }
  try {
    return `data:image/jpeg;base64,${fs.readFileSync(screenshotPath).toString("base64")}`;
  } catch {
    return null;
  }
};

const renderStep = (step: IRunViewStep): string => {
  const frame = inlineFrame(step.screenshotPath);
  const frameMarkup = frame
    ? `<a href="${frame}" target="_blank" rel="noreferrer"><img src="${frame}" alt="Step ${step.index} frame" loading="lazy"></a>`
    : `<p class="no-frame">no frame recorded</p>`;

  return `<li class="step">
  <div class="meta">
    <span class="index">${step.index}</span>
    <span class="action">${escapeHtml(step.action)}</span>
    ${step.url ? `<span class="url">${escapeHtml(step.url)}</span>` : ""}
  </div>
  <p class="explanation">${escapeHtml(step.explanation || "(no explanation recorded)")}</p>
  ${frameMarkup}
</li>`;
};

/**
 * Render a run as a self-contained HTML page, frames included.
 *
 * @param runView - The run to render.
 * @returns A complete HTML document with every frame inlined; no external assets.
 */
export function renderRunViewHtml(runView: IRunView): string {
  const title = `Run ${runView.runId}${runView.title ? ` — ${runView.title}` : ""}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; --bg:#ffffff; --fg:#1a1a1a; --muted:#666; --line:#e2e2e2; --chip:#f1f1f4; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#16161a; --fg:#ececf0; --muted:#9a9aa5; --line:#2c2c33; --chip:#24242b; }
  }
  body { margin:0; padding:24px 16px 64px; background:var(--bg); color:var(--fg);
         font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif; }
  .wrap { max-width: 1040px; margin: 0 auto; }
  h1 { font-size:20px; margin:0 0 4px; }
  .sub { color:var(--muted); margin:0 0 4px; }
  .path { color:var(--muted); font-family:ui-monospace,Menlo,Consolas,monospace; font-size:12px;
          word-break:break-all; margin:0 0 24px; }
  .verdict { border:1px solid var(--line); border-left:3px solid #c0392b; border-radius:6px;
             padding:12px 14px; margin:0 0 24px; background:var(--chip); }
  .verdict h2 { font-size:13px; text-transform:uppercase; letter-spacing:.04em; margin:0 0 6px; color:var(--muted); }
  ol { list-style:none; margin:0; padding:0; }
  .step { border-top:1px solid var(--line); padding:20px 0; }
  .meta { display:flex; gap:10px; align-items:baseline; flex-wrap:wrap; }
  .index { font-family:ui-monospace,Menlo,Consolas,monospace; color:var(--muted); }
  .action { font-weight:600; }
  .url { color:var(--muted); font-family:ui-monospace,Menlo,Consolas,monospace; font-size:12px; word-break:break-all; }
  .explanation { margin:6px 0 12px; }
  .no-frame { color:var(--muted); font-style:italic; margin:0; }
  img { max-width:100%; height:auto; border:1px solid var(--line); border-radius:6px; display:block; }
</style>
</head>
<body>
<div class="wrap">
  <h1>${escapeHtml(title)}</h1>
  <p class="sub">${escapeHtml(runView.status ?? "status unrecorded")} · ${runView.steps.length} steps · ${runView.screenshotCount} frames</p>
  <p class="path">${escapeHtml(runView.sessionPath)}</p>
  ${
    runView.verdict
      ? `<div class="verdict"><h2>Verdict the run recorded</h2><p>${escapeHtml(runView.verdict)}</p></div>`
      : ""
  }
  <ol>
${runView.steps.map(renderStep).join("\n")}
  </ol>
  ${runView.steps.length === 0 ? "<p class=\"no-frame\">No steps recorded — the run ended before writing any.</p>" : ""}
</div>
</body>
</html>`;
}

/**
 * Write the page beside the run's session directory.
 *
 * Creates the target directory when it is missing, so a `--out-dir` naming a fresh folder writes
 * rather than failing on the open.
 * @param runView - The run to render.
 * @param outputDir - Directory to write into; defaults to the current working directory.
 * @returns Absolute path of the written file.
 */
export function writeRunViewHtml(runView: IRunView, outputDir?: string): string {
  const targetDir = outputDir ?? process.cwd();
  fs.mkdirSync(targetDir, { recursive: true });
  const targetPath = path.join(targetDir, `run-${runView.runId}.html`);
  fs.writeFileSync(targetPath, renderRunViewHtml(runView), "utf8");
  return targetPath;
}
