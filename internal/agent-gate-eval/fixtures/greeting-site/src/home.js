import { renderGreeting } from "./greeting.js";

/** The home page: the visitor's greeting. */
function renderHomePage(visitorName) {
  return `<main>${renderGreeting(visitorName)}</main>`;
}

/** The home page's routes for one request URL, keyed by method and path. */
export function homeRoutes(url) {
  return { "GET /": () => renderHomePage(url.searchParams.get("name")) };
}
