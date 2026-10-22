import { describe, it, expect } from "vitest";
import { isNonAppPath, parseNoAppLogicChangeDetail } from "../../e2e-skip/noAppLogicChange";

describe("parseNoAppLogicChangeDetail", () => {
  it("splits the leading SHA from the reason", () => {
    expect(parseNoAppLogicChangeDetail("1a2b3c4 README typo")).toEqual({
      preCycleSha: "1a2b3c4",
      reason: "README typo",
    });
  });

  it("accepts a full SHA followed by a colon", () => {
    const fullSha = "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d";
    expect(parseNoAppLogicChangeDetail(`${fullSha}: docs`)).toEqual({ preCycleSha: fullSha, reason: "docs" });
  });

  it("keeps an empty reason when only the SHA is given", () => {
    expect(parseNoAppLogicChangeDetail("1a2b3c4")).toEqual({ preCycleSha: "1a2b3c4", reason: "" });
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
