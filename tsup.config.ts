import { defineConfig } from "tsup";

// Inline the AppInsights ingestion connection string at build time. Sourced
// from the APPLICATIONINSIGHTS_CONNECTION_STRING env var (set from a GitHub
// secret by the publish workflow). Local/dev builds leave this empty, which
// keeps client telemetry as a silent no-op outside of release builds.
const APPLICATIONINSIGHTS_CONNECTION_STRING =
  process.env.APPLICATIONINSIGHTS_CONNECTION_STRING ?? "";

export default defineConfig([
  {
    entry: {
      "index": "src/index.ts",
      "cli": "src/cli/main.ts",
    },
    format: ["esm"],
    target: "node22",
    outDir: "dist",
    clean: true,
    sourcemap: false,
    dts: false,
    splitting: true,
    treeshake: true,
    minify: false,
    define: {
      "process.env.APPLICATIONINSIGHTS_CONNECTION_STRING": JSON.stringify(
        APPLICATIONINSIGHTS_CONNECTION_STRING,
      ),
    },
    external: [
      "@modelcontextprotocol/sdk",
    ],
    noExternal: ["@muggleai/mcp"],
  },
  // Guardrail hook logic. Bundled self-contained (node builtins only) into the
  // plugin tree so the bash hooks can `node scripts/guardrails.mjs <sub>`;
  // build-plugin then copies plugin/ → dist/plugin/ for publish.
  {
    entry: { "guardrails": "src/guardrails/cli.ts" },
    format: ["esm"],
    target: "node22",
    outDir: "plugin/scripts",
    outExtension: () => ({ js: ".mjs" }),
    clean: false,
    sourcemap: false,
    dts: false,
    splitting: false,
    treeshake: true,
    minify: false,
  },
]);
