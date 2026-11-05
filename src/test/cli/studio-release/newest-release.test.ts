import { afterEach, describe, expect, it, vi } from "vitest";

import { MAX_RELEASE_LIST_PAGES } from "../../../cli/studio-release/constants.js";
import { fetchStudioReleases, parseNextPageUrl } from "../../../cli/studio-release/newest-release.js";

const PAGE_TWO_URL = "https://api.github.com/repositories/1/releases?per_page=100&page=2";
const PAGE_THREE_URL = "https://api.github.com/repositories/1/releases?per_page=100&page=3";

describe("parseNextPageUrl", () => {
  it("reads the next page out of a header that also links the last one", () => {
    expect(parseNextPageUrl(`<${PAGE_TWO_URL}>; rel="next", <${PAGE_THREE_URL}>; rel="last"`)).toBe(PAGE_TWO_URL);
  });

  it("returns null on the last page, whose header links only backwards", () => {
    expect(parseNextPageUrl(`<${PAGE_TWO_URL}>; rel="prev", <${PAGE_TWO_URL}>; rel="first"`)).toBeNull();
  });

  it("returns null when the response has no Link header", () => {
    expect(parseNextPageUrl(null)).toBeNull();
  });
});

describe("fetchStudioReleases", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stops with an error instead of walking a release list that never ends", async () => {
    const fetchMock = vi.fn(async () => new Response("[]", { headers: { link: `<${PAGE_TWO_URL}>; rel="next"` } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchStudioReleases()).rejects.toThrow(`runs past ${MAX_RELEASE_LIST_PAGES} pages`);
    expect(fetchMock).toHaveBeenCalledTimes(MAX_RELEASE_LIST_PAGES);
  });

  it("names the status of a page GitHub refuses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 403, statusText: "rate limit exceeded" })));
    await expect(fetchStudioReleases()).rejects.toThrow("GitHub API error: 403 rate limit exceeded");
  });
});
