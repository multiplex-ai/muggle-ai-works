import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "index": "src/index.ts",
    "cli": "src/cli/main.ts",
  },
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  dts: false,
  splitting: true,
  treeshake: true,
  minify: false,
  external: [
    "@modelcontextprotocol/sdk",
  ],
});
