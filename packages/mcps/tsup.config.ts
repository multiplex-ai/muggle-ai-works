import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
  },
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: false,
  dts: false,
  splitting: false,
  treeshake: true,
  minify: false,
  external: [
    "@modelcontextprotocol/sdk",
    "axios",
    "open",
    "uuid",
    "winston",
    "zod",
  ],
});
