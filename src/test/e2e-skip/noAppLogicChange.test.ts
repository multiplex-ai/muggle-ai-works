import { describe, it, expect } from "vitest";
import { isNonAppPath, parseNoAppLogicChangeDetail, pathsWithChangedPatch } from "../../e2e-skip/noAppLogicChange";

describe("parseNoAppLogicChangeDetail", () => {
  it("splits the leading SHA from the reason", () => {
    expect(parseNoAppLogicChangeDetail("1a2b3c4 README typo")).toEqual({
      preCycleSha: "1a2b3c4",
      baseTipSha: null,
      reason: "README typo",
    });
  });

  it("accepts a full SHA followed by a colon", () => {
    const fullSha = "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d";
    expect(parseNoAppLogicChangeDetail(`${fullSha}: docs`)).toEqual({
      preCycleSha: fullSha,
      baseTipSha: null,
      reason: "docs",
    });
  });

  it("keeps an empty reason when only the SHA is given", () => {
    expect(parseNoAppLogicChangeDetail("1a2b3c4")).toEqual({ preCycleSha: "1a2b3c4", baseTipSha: null, reason: "" });
  });

  it("reads a rebased cycle's pre-cycle head and base tip from a range", () => {
    expect(parseNoAppLogicChangeDetail("aeabe83d..be4b765c clean replay onto master")).toEqual({
      preCycleSha: "aeabe83d",
      baseTipSha: "be4b765c",
      reason: "clean replay onto master",
    });
  });

  it("returns null when the detail opens with no SHA", () => {
    expect(parseNoAppLogicChangeDetail("docs only")).toBeNull();
    expect(parseNoAppLogicChangeDetail("abc12")).toBeNull();
    expect(parseNoAppLogicChangeDetail("1a2b3c4zz docs")).toBeNull();
  });
});

describe("isNonAppPath", () => {
  it.each([
    "README.md",
    "docs/setup.markdown",
    "docs/api.rst",
    "src/cart.test.ts",
    "src/cart.spec.tsx",
    "src/__snapshots__/cart.test.ts.snap",
    "src/__mocks__/api.ts",
    "pkg/handler_test.go",
    "app/test_models.py",
    "test/fixtures/user.json",
    ".eslintrc.cjs",
    "packages/web/eslint.config.js",
    ".prettierignore",
    ".markdownlint.jsonc",
    "biome.json",
    ".editorconfig",
    ".github/workflows/ci.yml",
    ".gitlab-ci.yml",
  ])("treats %s as non-app", (repoRelativePath) => {
    expect(isNonAppPath(repoRelativePath)).toBe(true);
  });

  it.each([
    "src/app.ts",
    "app/about.mdx",
    "app/test/page.tsx",
    "package.json",
    "tsconfig.json",
    "public/robots.txt",
    ".github/CODEOWNERS",
    "src/styles.css",
  ])("treats %s as app logic", (repoRelativePath) => {
    expect(isNonAppPath(repoRelativePath)).toBe(false);
  });
});

const fileDiff = (path: string, blobs: string, hunks: string): string =>
  `diff --git a/${path} b/${path}\nindex ${blobs} 100644\n--- a/${path}\n+++ b/${path}\n${hunks}`;

const IMPORTS_ADDED =
  '+import { FanOutChoice } from "types/FanOutChoiceEnum";\n+import { buildRunTestRequest } from "utils/buildRunTestRequest";\n';

describe("pathsWithChangedPatch", () => {
  it("reports nothing when a rebase replays the PR's edits unchanged at new positions", () => {
    const before = fileDiff("src/header.tsx", "1111111..2222222", `@@ -40,0 +41,2 @@ import { ITestSummary }\n${IMPORTS_ADDED}`);
    const after = fileDiff("src/header.tsx", "3333333..4444444", `@@ -41,0 +42,2 @@ import { TestSummaryStatus }\n${IMPORTS_ADDED}`);

    expect(pathsWithChangedPatch(before, after)).toEqual([]);
  });

  it("reports a path whose own added or removed lines changed", () => {
    const before = fileDiff("src/header.tsx", "1111111..2222222", `@@ -40,0 +41,2 @@\n${IMPORTS_ADDED}`);
    const after = fileDiff("src/header.tsx", "3333333..4444444", `@@ -41,0 +42,1 @@\n+import { FanOutChoice } from "types/FanOutChoiceEnum";\n`);

    expect(pathsWithChangedPatch(before, after)).toEqual(["src/header.tsx"]);
  });

  it("reports a path the PR touches on only one side of the rebase", () => {
    const shared = fileDiff("README.md", "1111111..2222222", "@@ -1,0 +2 @@\n+Setup notes\n");
    const before = shared;
    const after = `${shared}${fileDiff("src/app.ts", "5555555..6666666", "@@ -3 +3 @@\n-old\n+new\n")}`;

    expect(pathsWithChangedPatch(before, after)).toEqual(["src/app.ts"]);
  });

  it("compares a binary change by the content it leaves behind", () => {
    const binary = (blobs: string): string =>
      `diff --git a/public/logo.png b/public/logo.png\nindex ${blobs} 100644\nBinary files a/public/logo.png and b/public/logo.png differ\n`;

    expect(pathsWithChangedPatch(binary("aaaaaaa..bbbbbbb"), binary("ccccccc..bbbbbbb"))).toEqual([]);
    expect(pathsWithChangedPatch(binary("aaaaaaa..bbbbbbb"), binary("ccccccc..ddddddd"))).toEqual(["public/logo.png"]);
  });

  it("keys a path that contains spaces by its full name", () => {
    const diff = fileDiff("docs/release notes.md", "1111111..2222222", "@@ -1,0 +2 @@\n+v2\n");

    expect(pathsWithChangedPatch("", diff)).toEqual(["docs/release notes.md"]);
  });
});
