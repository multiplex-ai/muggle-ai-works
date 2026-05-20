/**
 * URL rewriting for action-script replay against a local dev URL.
 *
 * Cloud-recorded action scripts encode the original environment's URLs in
 * both the top-level testScript metadata and inside individual step
 * operations (especially the first `navigate`, which is usually a stateful
 * auth redirect like `login.<host>/u/login?state=...`). When replaying
 * locally we want those URLs pointed at the local origin so the journey
 * actually exercises the local app.
 */

/**
 * Rewrite URLs in an action script to use `localUrl` instead of the cloud
 * URL the script was recorded against.
 *
 * Substitution covers two cases:
 *   1. Any URL whose hostname equals or is a subdomain of `originalUrl`'s
 *      hostname is rewritten to `localUrl`'s origin (so e.g.
 *      `login.staging.muggle-ai.com/...` rewrites alongside
 *      `staging.muggle-ai.com/...` when the original is `staging.muggle-ai.com`).
 *      Unrelated hosts like `accounts.google.com` are left alone.
 *   2. The first `navigate` step's URL is forced to `localUrl` regardless of
 *      what was recorded. The recorded URL is often a stateful auth redirect
 *      that's invalid in the local env; starting the journey at `localUrl`
 *      lets the local app's own auth redirect chain take over.
 *
 * @param params - Rewrite parameters.
 * @param params.actionScript - Original action script steps.
 * @param params.originalUrl - Original cloud URL the script was recorded against.
 * @param params.localUrl - Local URL to redirect to.
 * @returns Action script with rewritten URLs.
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

/**
 * Force the first `navigate` step's URL to `localUrl`. Mutates `steps`.
 */
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
