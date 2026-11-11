import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  listAgentDocResources,
  readAgentDocResource,
  resolveWorksPackageRoot,
} from "../../server/docs-resources/docs-resources.js";
import { AgentDocResourceUri } from "../../server/docs-resources/types.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const contractDescription = "Acceptance test agent for coding agents: real-browser tests, with screenshots on the PR.";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const temporaryDirectory of temporaryDirectories.splice(0)) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

describe("listAgentDocResources", () => {
  it("lists AGENTS.md and llms.txt without exposing file paths", () => {
    const listing = listAgentDocResources();
    expect(listing.map((docResource) => docResource.uri)).toEqual([
      AgentDocResourceUri.Agents,
      AgentDocResourceUri.Llms,
    ]);
    for (const docResource of listing) {
      expect(docResource.name).not.toBe("");
      expect(docResource.description).not.toBe("");
      expect(docResource).not.toHaveProperty("packageRelativePath");
    }
  });
});

describe("readAgentDocResource", () => {
  it("returns AGENTS.md byte for byte", () => {
    const contents = readAgentDocResource(AgentDocResourceUri.Agents);
    expect(contents).toEqual({
      uri: AgentDocResourceUri.Agents,
      mimeType: "text/markdown",
      text: readFileSync(path.join(repositoryRoot, "AGENTS.md"), "utf-8"),
    });
  });

  it("returns llms.txt, whose summary line is the canonical description", () => {
    const contents = readAgentDocResource(AgentDocResourceUri.Llms);
    expect(contents?.mimeType).toBe("text/plain");
    expect(contents?.text).toContain(`> ${contractDescription}`);
  });

  it("returns undefined for a URI that names no agent doc", () => {
    expect(readAgentDocResource("muggle://docs/unknown")).toBeUndefined();
  });
});

describe("resolveWorksPackageRoot", () => {
  it("skips nested workspace packages and stops at @muggleai/works", () => {
    expect(resolveWorksPackageRoot(path.join(repositoryRoot, "packages", "mcps", "src"))).toBe(repositoryRoot);
  });

  it("throws when no ancestor is the package", () => {
    const isolatedDirectory = mkdtempSync(path.join(tmpdir(), "muggle-docs-root-"));
    temporaryDirectories.push(isolatedDirectory);
    expect(() => resolveWorksPackageRoot(isolatedDirectory)).toThrow(/No @muggleai\/works package root/);
  });
});

describe("package manifest", () => {
  it("ships both agent docs in the npm files list", () => {
    const packageJson = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf-8")) as {
      files: string[];
    };
    expect(packageJson.files).toEqual(expect.arrayContaining(["AGENTS.md", "llms.txt"]));
  });
});
