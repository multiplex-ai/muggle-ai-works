import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const workflow = readFileSync(
  fileURLToPath(new URL("../../../.github/workflows/publish-works-to-npm.yml", import.meta.url)),
  "utf-8",
).replace(/\r\n/g, "\n");

const indexOfStep = (command: string): number => {
  const at = workflow.indexOf(command);
  if (at === -1) throw new Error(`the publish workflow no longer runs \`${command}\``);
  return at;
};

// `npm version` writes package.json alone. Every manifest the tarball ships —
// both plugin manifests, both marketplace manifests, server.json — takes its
// version from sync-versions.mjs, and for three channels' worth of releases the
// publish workflow never called it: 5.19.0-staging.125 shipped with all four of
// its plugin manifests reading 5.18.0. Production only looked correct because
// /mrelease syncs them in the release PR, so the tag publish found them already
// right. Nothing about that protects the staging channel.
describe("the publish workflow syncs manifests to the version it publishes", () => {
  const syncAt = (): number => indexOfStep("pnpm run sync:versions");

  it("syncs the version into every manifest", () => {
    expect(() => syncAt()).not.toThrow();
  });

  // Ordering is the whole guarantee: a sync that runs before the bump copies
  // the version the bump is about to replace, and passes every check while
  // shipping the same stale manifests.
  it("syncs after every step that sets the version", () => {
    const bumps = [...workflow.matchAll(/npm version "\$[A-Z_]+"/g)].map((m) => m.index ?? -1);
    expect(bumps.length).toBeGreaterThanOrEqual(3);
    for (const bump of bumps) {
      expect(bump, "a version bump runs after the manifest sync").toBeLessThan(syncAt());
    }
  });

  // dist/plugin/ is assembled by the earlier Build step, before the bump, and
  // package.json `files` ships dist alongside plugin — so without a rebuild the
  // built manifests reach users still carrying the pre-bump version.
  it("rebuilds the plugin artifact after syncing", () => {
    expect(indexOfStep("pnpm run build:plugin")).toBeGreaterThan(syncAt());
  });

  // The invariant always had a checker; it had never run where it could fail.
  it("verifies the manifests agree before packing", () => {
    const verifyAt = indexOfStep("pnpm run verify:plugin");
    expect(verifyAt).toBeGreaterThan(indexOfStep("pnpm run build:plugin"));
    expect(verifyAt).toBeLessThan(indexOfStep("Pack npm package"));
  });
});
