# MCP Core Package

This package hosts migrated core MCP runtime logic from the current root implementation.

Current migration slice:

- `src/shared/types.ts`
- `src/shared/checksum.ts`
- `src/shared/logger.ts`
- `src/shared/data-dir.ts`
- `src/shared/open-browser.ts`
- `src/shared/credentials.ts`
- `src/shared/config.ts`
- `src/shared/auth.ts`
- `src/mcp/**` (MCP tool/runtime implementation; root app imports via `@muggleai/mcp`)
