/**
 * `muggle build-pr-section` CLI handler.
 *
 * Reads an e2e-acceptance report JSON from stdin, renders the PR body evidence
 * block (and optionally an overflow comment), and writes `{body, comment}` JSON
 * to stdout. All logging goes to stderr so stdout is machine-parseable.
 */

import { ZodError } from "zod";

import { buildPrSection, E2eReportSchema } from "./pr-section/index.js";

/** Default UTF-8 byte budget for the PR description. */
export const DEFAULT_MAX_BODY_BYTES = 60_000;

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
  const result = buildPrSection(report, { maxBodyBytes: opts.maxBodyBytes });
  opts.stdoutWrite(JSON.stringify({ body: result.body, comment: result.comment }));
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
