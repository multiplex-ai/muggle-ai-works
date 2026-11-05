/** First page of the Studio release list, at the API's largest page size so the walk takes the fewest requests. */
export const GITHUB_RELEASES_API = "https://api.github.com/repos/multiplex-ai/muggle-ai-works/releases?per_page=100";

/** Headers sent with every releases API request. */
export const GITHUB_RELEASES_API_HEADERS: Readonly<Record<string, string>> = {
  "Accept": "application/vnd.github.v3+json",
  "User-Agent": "muggle",
};

/** Response header that links to the next page of the release list. */
export const PAGINATION_LINK_HEADER = "link";

/** Captures the next page's URL from a `Link` header. */
export const NEXT_PAGE_LINK_PATTERN = /<([^>]+)>;\s*rel="next"/;

/**
 * Most pages read before the walk gives up, so a list that never ends cannot hang an upgrade.
 * At 100 releases a page this is far above the list's size.
 */
export const MAX_RELEASE_LIST_PAGES = 50;
