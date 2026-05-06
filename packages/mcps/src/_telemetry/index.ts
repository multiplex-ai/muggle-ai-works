// Internal indirection to the vendored telemetry source. The _vendor folder is
// produced at build time by scripts/fetch-telemetry.mjs and gitignored. This
// re-exporter is the only place outside the build script that knows about the
// vendor location, and it deliberately does not name @multiplex-ai/telemetry.

export * from "./_vendor/index.js";
