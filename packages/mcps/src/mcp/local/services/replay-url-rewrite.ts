/** Point cloud-recorded action script URLs at a local dev URL for replay. */

/**
 * Rewrite URLs in an action script for local replay: any URL whose host
 * equals or is a subdomain of `originalUrl`'s host swaps to `localUrl`'s
 * origin, and the first `navigate` step is forced to `localUrl` (the
 * recorded value is usually a stateful auth redirect that can't replay).
 */
export function rewriteActionScriptUrls(params: {
  actionScript: unknown[];
  originalUrl?: string;
  localUrl: string;
}): unknown[] {
  const { actionScript, originalUrl, localUrl } = params;

  if (!originalUrl) {
    return actionScript;
  }

  let originalHost: string;
  let localOrigin: string;
  try {
    originalHost = new URL(originalUrl).hostname;
    localOrigin = new URL(localUrl).origin;
  } catch {
    const serialized = JSON.stringify(actionScript);
    const rewritten = serialized.replace(new RegExp(escapeRegex(originalUrl), "g"), localUrl);
    return JSON.parse(rewritten) as unknown[];
  }

  const hostPattern = new RegExp(
    `https?://(?:[a-z0-9-]+\\.)*${escapeRegex(originalHost)}(?=[/?#:"'\\\\]|$)`,
    "gi",
  );

  const serialized = JSON.stringify(actionScript);
  const rewritten = serialized.replace(hostPattern, localOrigin);
  const result = JSON.parse(rewritten) as unknown[];

  forceFirstNavigateUrl({ steps: result, localUrl: localUrl });
  return result;
}

function forceFirstNavigateUrl(params: { steps: unknown[]; localUrl: string }): void {
  for (const step of params.steps) {
    if (!isPlainObject(step)) continue;
    const operation = step["operation"];
    if (!isPlainObject(operation)) continue;
    if (operation["action"] !== "navigate") continue;
    operation["url"] = params.localUrl;
    return;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
