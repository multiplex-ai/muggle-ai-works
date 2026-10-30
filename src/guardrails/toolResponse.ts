/**
 * Every string in an MCP tool's response, joined by newlines.
 *
 * A result's shape differs by host — a plain string on one, an array of typed
 * parts on another, sometimes wrapped again — and reading one assumed field is
 * how a detector becomes dead code on the host that nests it differently.
 */
export function flattenToolResponse(toolResponse: unknown): string {
  const rendered: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === "string") rendered.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  collect(toolResponse);
  return rendered.join("\n");
}
