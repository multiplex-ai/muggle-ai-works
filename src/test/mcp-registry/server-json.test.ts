import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fromRoot = (relativePath: string): string =>
  fileURLToPath(new URL(`../../../${relativePath}`, import.meta.url));

const readJson = <T>(relativePath: string): T => JSON.parse(readFileSync(fromRoot(relativePath), "utf-8")) as T;

interface RegistryPackageArgument {
  type: string;
  value?: string;
}

interface RegistryPackage {
  registryType: string;
  identifier: string;
  version: string;
  runtimeHint?: string;
  transport: { type: string };
  packageArguments?: RegistryPackageArgument[];
}

interface RegistryServer {
  $schema: string;
  name: string;
  description: string;
  version: string;
  packages: RegistryPackage[];
}

interface PluginMcpConfig {
  mcpServers: Record<string, { command: string; args: string[] }>;
}

const SERVER_SCHEMA_URL = "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json";
const REGISTRY_DESCRIPTION_MAX_LENGTH = 100;

// Property lists of ServerDetail and Package in the schema above. The schema
// allows extra properties and the registry drops them silently, so a misspelt
// field such as `runtimeArgs` for `runtimeArguments` publishes "valid" and never
// reaches a client.
const SERVER_DETAIL_PROPERTIES = [
  "$schema",
  "_meta",
  "description",
  "icons",
  "name",
  "packages",
  "remotes",
  "repository",
  "title",
  "version",
  "websiteUrl",
];
const PACKAGE_PROPERTIES = [
  "environmentVariables",
  "fileSha256",
  "identifier",
  "packageArguments",
  "registryBaseUrl",
  "registryType",
  "runtimeArguments",
  "runtimeHint",
  "transport",
  "version",
];

describe("server.json lists @muggleai/works in the MCP Registry", () => {
  const server = readJson<RegistryServer>("server.json");
  const packageJson = readJson<{ name: string; version: string; mcpName: string }>("package.json");
  const [registryPackage] = server.packages;

  it("targets the schema version the registry validates against", () => {
    expect(server.$schema).toBe(SERVER_SCHEMA_URL);
  });

  // The registry grants the listing only when the published npm version's
  // `mcpName` equals this name.
  it("uses the package.json mcpName as its name", () => {
    expect(server.name).toBe(packageJson.mcpName);
  });

  it("points at the npm package package.json publishes", () => {
    expect(server.packages).toHaveLength(1);
    expect(registryPackage.registryType).toBe("npm");
    expect(registryPackage.identifier).toBe("@muggleai/works");
    expect(registryPackage.identifier).toBe(packageJson.name);
  });

  it("carries the package.json version at the top level and on the package", () => {
    expect(server.version).toBe(packageJson.version);
    expect(registryPackage.version).toBe(packageJson.version);
  });

  it("keeps the description within the registry's limit", () => {
    expect(server.description.length).toBeGreaterThan(0);
    expect(server.description.length).toBeLessThanOrEqual(REGISTRY_DESCRIPTION_MAX_LENGTH);
  });

  it("uses only fields the registry schema defines", () => {
    expect(Object.keys(server).filter((key) => !SERVER_DETAIL_PROPERTIES.includes(key))).toEqual([]);
    expect(Object.keys(registryPackage).filter((key) => !PACKAGE_PROPERTIES.includes(key))).toEqual([]);
  });

  // A registry client runs `<runtimeHint> <identifier> <packageArguments>`; it
  // must start the same stdio server the plugin's own MCP config starts.
  it("launches the MCP server the way the plugin does", () => {
    const pluginLaunch = readJson<PluginMcpConfig>("plugin/.mcp.json").mcpServers.muggle;
    const packageSpecAt = pluginLaunch.args.findIndex((arg) => arg.startsWith(registryPackage.identifier));

    expect(registryPackage.transport.type).toBe("stdio");
    expect(registryPackage.runtimeHint).toBe(pluginLaunch.command);
    expect(packageSpecAt).toBeGreaterThanOrEqual(0);
    expect((registryPackage.packageArguments ?? []).map((argument) => argument.value)).toEqual(
      pluginLaunch.args.slice(packageSpecAt + 1),
    );
  });
});
