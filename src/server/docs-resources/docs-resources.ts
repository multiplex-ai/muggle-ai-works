import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AGENT_DOC_RESOURCES, WORKS_PACKAGE_NAME } from "./constants.js";
import type { IAgentDocResourceContents, IListedAgentDocResource } from "./types.js";

let cachedWorksPackageRoot: string | undefined;

/**
 * Find the nearest directory at or above `startDirectory` whose package.json names `@muggleai/works`.
 * Works from the bundled `dist/` chunk and from `src/` alike; the nested workspace packages carry other names.
 * @param startDirectory - Directory to start the upward search from.
 * @returns Absolute path of the package root.
 * @throws Error when no ancestor holds the package.
 */
export function resolveWorksPackageRoot (startDirectory: string): string {
  let candidateDirectory = path.resolve(startDirectory);
  for (;;) {
    const packageJsonPath = path.join(candidateDirectory, "package.json");
    if (existsSync(packageJsonPath) && readPackageName(packageJsonPath) === WORKS_PACKAGE_NAME) {
      return candidateDirectory;
    }
    const parentDirectory = path.dirname(candidateDirectory);
    if (parentDirectory === candidateDirectory) {
      throw new Error(`No ${WORKS_PACKAGE_NAME} package root found at or above ${startDirectory}`);
    }
    candidateDirectory = parentDirectory;
  }
}

function readPackageName (packageJsonPath: string): string | undefined {
  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { name?: unknown; };
    return typeof packageJson.name === "string" ? packageJson.name : undefined;
  } catch {
    return undefined;
  }
}

function getWorksPackageRoot (): string {
  cachedWorksPackageRoot ??= resolveWorksPackageRoot(path.dirname(fileURLToPath(import.meta.url)));
  return cachedWorksPackageRoot;
}

/**
 * List the agent docs the MCP server serves.
 * @returns One entry per doc, without its file path.
 */
export function listAgentDocResources (): IListedAgentDocResource[] {
  return AGENT_DOC_RESOURCES.map((docResource) => ({
    uri: docResource.uri,
    name: docResource.name,
    title: docResource.title,
    description: docResource.description,
    mimeType: docResource.mimeType,
  }));
}

/**
 * Read one agent doc from the installed package.
 * @param uri - Resource URI from resources/read.
 * @returns The doc's text, or undefined when the URI names no agent doc.
 * @throws Error when the URI is known but its file is missing from the package.
 */
export function readAgentDocResource (uri: string): IAgentDocResourceContents | undefined {
  const docResource = AGENT_DOC_RESOURCES.find((candidate) => candidate.uri === uri);
  if (!docResource) {
    return undefined;
  }
  const docFilePath = path.join(getWorksPackageRoot(), docResource.packageRelativePath);
  return {
    uri: docResource.uri,
    mimeType: docResource.mimeType,
    text: readFileSync(docFilePath, "utf-8"),
  };
}
