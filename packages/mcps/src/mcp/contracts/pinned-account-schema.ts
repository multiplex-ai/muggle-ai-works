import { z } from "zod";

import { MuggleEntityIdSchema } from "./muggle-entity-id-schema.js";

/** The pair of project secrets a test case signs in with. */
export const PinnedAccountSchema = z.object({
  emailSecretId: MuggleEntityIdSchema.describe("Secret ID (UUID) of the secret holding the account email"),
  passwordSecretId: MuggleEntityIdSchema.describe("Secret ID (UUID) of the secret holding the account password"),
});
