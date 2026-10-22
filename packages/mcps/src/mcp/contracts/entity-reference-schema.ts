import { z } from "zod";

import { ENTITY_REFERENCE_INVALID_MESSAGE, SHORT_ID_REFERENCE_PATTERN } from "./entity-reference-constants.js";
import { MuggleEntityIdSchema } from "./muggle-entity-id-schema.js";

/** A use case, test case, test script or replay reference: its full ID (UUID) or its project short ID (TC-42). */
export const EntityReferenceSchema = z
  .string()
  .trim()
  .refine(
    (reference) => MuggleEntityIdSchema.safeParse(reference).success || SHORT_ID_REFERENCE_PATTERN.test(reference),
    { message: ENTITY_REFERENCE_INVALID_MESSAGE },
  )
  .describe("Full ID or project short ID, e.g. TC-42");

/** The project a short ID in the same input belongs to, on tools whose upstream call needs no project. */
export const EntityReferenceProjectIdSchema = MuggleEntityIdSchema.optional().describe(
  "Project ID (UUID) the short ID belongs to. Required when a short ID is given; ignored for a full ID.",
);
