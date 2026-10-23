/**
 * Body of the first heading matching `headingPattern`, up to the next heading of the same or higher level.
 *
 * @param doc - Markdown source.
 * @param headingPattern - Multiline pattern matching the whole heading line, e.g. `/^### Step 2:.*$/m`.
 * @returns The section body without its heading, or `""` when no heading matches.
 */
export function sectionBody(doc: string, headingPattern: RegExp): string {
  const heading = doc.match(headingPattern);
  if (!heading || heading.index === undefined) return "";
  const level = heading[0].match(/^#+/)![0].length;
  const rest = doc.slice(heading.index + heading[0].length);
  const nextHeading = rest.search(new RegExp(String.raw`^#{1,${level}} `, "m"));
  return nextHeading === -1 ? rest : rest.slice(0, nextHeading);
}

/**
 * GitHub-style anchor slugs of every heading in a markdown document.
 *
 * @param doc - Markdown source.
 * @returns Slugs as GitHub renders them, e.g. `### Step 1 — Enumerate` → `step-1--enumerate`.
 */
export function headingAnchors(doc: string): Set<string> {
  const headingLines = doc.match(/^#{1,6} .+$/gm) ?? [];
  return new Set(
    headingLines.map((line) =>
      line
        .replace(/^#+ /, "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N} _-]/gu, "")
        .replace(/ /g, "-"),
    ),
  );
}
