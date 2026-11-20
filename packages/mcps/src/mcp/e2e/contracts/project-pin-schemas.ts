import { z } from "zod";

import { MuggleEntityIdSchema } from "../../contracts/muggle-entity-id-schema.js";

/** Input of muggle-remote-project-pin and muggle-remote-project-unpin. */
export const ProjectPinInputSchema = z.object({
  projectId: MuggleEntityIdSchema.describe("Project ID (UUID) to pin or unpin"),
});
