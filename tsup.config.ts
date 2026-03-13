import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  dts: false,
  splitting: false,
  treeshake: true,
  minify: false,
  external: [
    "@modelcontextprotocol/sdk",
  ],
});
