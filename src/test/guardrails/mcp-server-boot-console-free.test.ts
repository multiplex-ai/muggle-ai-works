import { describe, it, expect } from "vitest";
import { DEFAULT_RESOURCE_DETECTORS, MCP_SERVER_BOOT_TIMEOUT_MS } from "./support/constants.js";
import { bootMcpServerRecordingUnhiddenSpawns } from "./support/mcpServerBoot.js";

// Every agent session starts its own MCP server, and a background-session host can start dozens in minutes. A
// console child started at boot without windowsHide is a window flashing over whatever the user is typing into, once
// per session. Dependencies spawn too, where no scan of this repository's sources can see them, so this boots the
// real server and records what it starts.
describe("MCP server startup", () => {
  it(
    "starts no child process without windowsHide, telemetry and its dependencies included",
    async () => {
      expect(await bootMcpServerRecordingUnhiddenSpawns()).toEqual([]);
    },
    MCP_SERVER_BOOT_TIMEOUT_MS,
  );

  // Linux reads the machine id from a file; Windows and macOS shell out for it, which the recorder must see.
  it.skipIf(process.platform === "linux")(
    "is recorded spawning when the host resource detector is switched back on",
    async () => {
      const recordedSpawns = await bootMcpServerRecordingUnhiddenSpawns({
        OTEL_NODE_RESOURCE_DETECTORS: DEFAULT_RESOURCE_DETECTORS,
      });
      expect(recordedSpawns.length).toBeGreaterThan(0);
    },
    MCP_SERVER_BOOT_TIMEOUT_MS,
  );
});
