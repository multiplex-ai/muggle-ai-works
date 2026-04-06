/**
 * Shared Zod schema for Muggle entity identifiers stored as UUIDs.
 *
 * Used for cloud resource IDs (projects, use cases, test cases, scripts, secrets, workflows)
 * and for local run-result / test-script record filenames (randomUUID).
 */

import { z } from "zod";

/**
 * UUID string schema — single source of truth for Muggle ID validation across MCP contracts.
 */
export const MuggleEntityIdSchema = z.string().uuid();
