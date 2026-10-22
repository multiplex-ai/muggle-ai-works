import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

import {
  MCP_PACKAGE_NAME,
  pinMcpPackageSpec,
  PLUGIN_MCP_CONFIG_PATHS,
} from "../../../scripts/pin-plugin-mcp-package.mjs";

const repositoryRootPath = join(__dirname, "..", "..", "..");

describe("pinMcpPackageSpec", () => {
  it("pins the server's package to the plugin's own version and keeps every other argument", () => {
    const pinnedConfig = pinMcpPackageSpec(
      { mcpServers: { muggle: { command: "npx", args: ["-y", MCP_PACKAGE_NAME, "serve"], env: { A: "1" } } } },
      "5.24.0-staging.164",
    );
    expect(pinnedConfig.mcpServers.muggle).toEqual({
      command: "npx",
      args: ["-y", `${MCP_PACKAGE_NAME}@5.24.0-staging.164`, "serve"],
      env: { A: "1" },
    });
  });

  it("re-pins an already pinned config instead of stacking versions", () => {
    const pinnedConfig = pinMcpPackageSpec(
      { mcpServers: { muggle: { args: ["-y", `${MCP_PACKAGE_NAME}@5.23.0`, "serve"] } } },
      "5.24.0",
    );
    expect(pinnedConfig.mcpServers.muggle.args).toEqual(["-y", `${MCP_PACKAGE_NAME}@5.24.0`, "serve"]);
  });

  it("refuses a config that does not launch the MCP package", () => {
    expect(() => pinMcpPackageSpec({ mcpServers: { muggle: { args: ["serve"] } } }, "5.24.0")).toThrow(
      MCP_PACKAGE_NAME,
    );
  });

  it("finds the MCP package in every plugin config it pins", () => {
    for (const relativePath of PLUGIN_MCP_CONFIG_PATHS) {
      const sourceConfig = JSON.parse(readFileSync(join(repositoryRootPath, relativePath), "utf-8"));
      expect(() => pinMcpPackageSpec(sourceConfig, "0.0.0"), relativePath).not.toThrow();
    }
  });
});
