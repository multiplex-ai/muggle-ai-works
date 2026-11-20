import { z } from "zod";

import { MuggleEntityIdSchema } from "../../contracts/muggle-entity-id-schema.js";
import { PaginationInputSchema } from "./pagination-schemas.js";
import { ProjectAccessPrincipalTypeEnum, ProjectAccessRoleEnum } from "./project-access-types.js";

const ProjectAccessProjectIdSchema = MuggleEntityIdSchema.describe("Project ID (UUID)");
const ProjectAccessPrincipalTypeSchema = z
  .enum(ProjectAccessPrincipalTypeEnum)
  .describe("USER for one user, TEAM for a whole team");
const ProjectAccessPrincipalIdSchema = z
  .string()
  .min(1)
  .describe("User ID (for USER) or team ID (for TEAM), as muggle-remote-project-access-list reports it");
const ProjectAccessRoleSchema = z
  .enum(ProjectAccessRoleEnum)
  .describe("EDITOR edits the project, its tests and runs; MAINTAINER can also manage collaborators; VIEWER only reads");

/** Input of muggle-remote-project-access-list. */
export const ProjectAccessListInputSchema = z.object({
  projectId: ProjectAccessProjectIdSchema,
});

/** Input of muggle-remote-project-access-grant. */
export const ProjectAccessGrantInputSchema = z.object({
  projectId: ProjectAccessProjectIdSchema,
  principalType: ProjectAccessPrincipalTypeSchema,
  principalId: ProjectAccessPrincipalIdSchema,
  role: ProjectAccessRoleSchema,
});

/** Input of muggle-remote-project-access-revoke. */
export const ProjectAccessRevokeInputSchema = z.object({
  projectId: ProjectAccessProjectIdSchema,
  principalType: ProjectAccessPrincipalTypeSchema,
  principalId: ProjectAccessPrincipalIdSchema,
});

/** Input of muggle-remote-project-invite. */
export const ProjectInviteInputSchema = z.object({
  projectId: ProjectAccessProjectIdSchema,
  email: z.string().email().describe("Email address to invite"),
  role: ProjectAccessRoleSchema,
});

/** Input of muggle-remote-project-invitation-list. */
export const ProjectInvitationListInputSchema = z
  .object({
    projectId: ProjectAccessProjectIdSchema,
  })
  .merge(PaginationInputSchema);

/** Input of muggle-remote-project-ownership-transfer. */
export const ProjectOwnershipTransferInputSchema = z.object({
  projectId: ProjectAccessProjectIdSchema,
  newOwnerUserId: z
    .string()
    .min(1)
    .describe("User ID of the new owner, e.g. a collaborator's principalId from muggle-remote-project-access-list"),
});
