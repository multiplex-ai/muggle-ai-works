/**
 * `muggle build-pr-section` CLI handler.
 *
 * Reads an e2e-acceptance report JSON from stdin, renders the PR body evidence
 * block (and optionally an overflow comment), and writes `{body, comment}` JSON
 * to stdout. All logging goes to stderr so stdout is machine-parseable.
 */

import { ZodError } from "zod";

import { buildPrSection, E2eReportSchema } from "./pr-section/index.js";
import { DASHBOARD_URL_BASE } from "./pr-section/render.js";
import { resolveGsScreenshotUrls } from "./pr-section/resolve-urls.js";

/** Default UTF-8 byte budget for the PR description. */
export const DEFAULT_MAX_BODY_BYTES = 60_000;

/**
 * Invisible marker prepended to every rendered section. GitHub hides HTML
 * comments, so reviewers never see it — but the guardrails (see
 * src/guardrails/prReportPost.ts) read it both to tell a CLI-rendered
 * walkthrough apart from a hand-written one and block the latter, and to
 * recognise that a PR already carries a walkthrough.
 */
export const REPORT_SECTION_SENTINEL = "<!-- muggle-pr-section:v1 -->";

const withSentinel = <T extends string | null>(s: T): T =>
  (s ? (`${REPORT_SECTION_SENTINEL}\n${s}` as T) : s);

/**
 * Dashboard projects base for the ring this CLI is pointed at.
 *
 * A staging run's evidence must link into the staging dashboard; emitting the
 * production host sends reviewers to a different environment than the one the
 * run happened in. Falls back to the renderer's production default when the
 * target cannot be resolved, so rendering never fails over a link.
 * @param stderrWrite - Sink for the fallback warning.
 * @returns Base URL ending in `/dashboard/projects`, without a trailing slash.
 */
async function resolveDashboardBaseUrl (stderrWrite: (s: string) => void): Promise<string> {
  try {
    const mcps = await import("../../packages/mcps/src/index.js");
    return `${mcps.resolveActiveProfile().uiBaseUrl}/dashboard/projects`;
  } catch (err) {
    stderrWrite(
      `build-pr-section: could not resolve the runtime target, linking to production: ${errMsg(err)}\n`,
    );
    return DASHBOARD_URL_BASE;
  }
}

interface IRunOptions {
  stdin: NodeJS.ReadableStream;
  stdoutWrite: (s: string) => boolean;
  stderrWrite: (s: string) => boolean;
  maxBodyBytes: number;
}

async function readAll (stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function errMsg (e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Pure-ish entry point used by the Commander action and by tests.
 * Returns the desired process exit code instead of calling process.exit itself.
 */
export async function runBuildPrSection (opts: IRunOptions): Promise<number> {
  let raw: string;
  try {
    raw = await readAll(opts.stdin);
  } catch (err) {
    opts.stderrWrite(`build-pr-section: failed to read stdin: ${errMsg(err)}\n`);
    return 1;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    opts.stderrWrite(`build-pr-section: failed to parse stdin as JSON: ${errMsg(err)}\n`);
    return 1;
  }
  let report;
  try {
    report = E2eReportSchema.parse(json);
  } catch (err) {
    if (err instanceof ZodError) {
      opts.stderrWrite(
        `build-pr-section: report validation failed:\n${err.issues
          .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
          .join("\n")}\n`,
      );
    } else {
      opts.stderrWrite(`build-pr-section: report validation failed: ${errMsg(err)}\n`);
    }
    return 1;
  }
  const resolvedReport = await resolveGsScreenshotUrls(report, { stderrWrite: opts.stderrWrite });
  const sentinelCost = Buffer.byteLength(`${REPORT_SECTION_SENTINEL}\n`, "utf-8");
  const renderedSection = buildPrSection(resolvedReport, {
    maxBodyBytes: opts.maxBodyBytes - sentinelCost,
    dashboardBaseUrl: await resolveDashboardBaseUrl(opts.stderrWrite),
  });
  opts.stdoutWrite(
    JSON.stringify({
      body: withSentinel(renderedSection.body),
      comment: withSentinel(renderedSection.comment),
    }),
  );
  return 0;
}

/** Commander action. */
export async function buildPrSectionCommand (options: { maxBodyBytes?: string }): Promise<void> {
  const maxBodyBytes = options.maxBodyBytes ? Number(options.maxBodyBytes) : DEFAULT_MAX_BODY_BYTES;
  if (!Number.isFinite(maxBodyBytes) || maxBodyBytes <= 0) {
    process.stderr.write(`build-pr-section: --max-body-bytes must be a positive number\n`);
    process.exitCode = 1;
    return;
  }
  const code = await runBuildPrSection({
    stdin: process.stdin,
    stdoutWrite: (s) => process.stdout.write(s),
    stderrWrite: (s) => process.stderr.write(s),
    maxBodyBytes,
  });
  if (code !== 0) {
    process.exitCode = code;
  }
}
