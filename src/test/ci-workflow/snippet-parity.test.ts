import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { renderUserWorkflow } from "../../ci-workflow/template";
import { USER_WORKFLOW_COMMAND } from "../../ci-workflow/constants";

const README = fileURLToPath(new URL("../../../README.md", import.meta.url));
const SNIPPET = /<!-- muggle:ci-workflow-snippet -->\n```yaml\n([\s\S]*?)```\n<!-- \/muggle:ci-workflow-snippet -->/;

// A documented workflow is a second copy of the scaffolded one, and the copy is
// what rots: someone fixes a permission in the template, the README keeps
// telling hand-installers the broken version, and nobody notices because both
// "work" until a check silently cannot publish.
describe("the documented workflow matches the one ci-install writes", () => {
  const documented = (): string => {
    const found = readFileSync(README, "utf-8").replace(/\r\n/g, "\n").match(SNIPPET);
    if (!found) throw new Error("the README's ci-workflow snippet markers are missing");
    return found[1];
  };

  it("keeps every line of the snippet present in the rendered template", () => {
    const rendered = renderUserWorkflow();
    for (const line of documented().split("\n").filter((l) => l.trim() !== "")) {
      expect(rendered, `README line not in the scaffolded workflow: ${line}`).toContain(line);
    }
  });

  it("documents the same invocation the scaffolder writes", () => {
    expect(documented()).toContain(USER_WORKFLOW_COMMAND);
    expect(renderUserWorkflow()).toContain(USER_WORKFLOW_COMMAND);
  });
});
