import { z } from "zod";

import { MuggleEntityIdSchema } from "../../contracts/muggle-entity-id-schema.js";

const IntegrationProjectIdSchema = MuggleEntityIdSchema.describe("Project ID (UUID)");

/** Input of the project integration tools that take only the project: Slack and GitHub list and disconnect. */
export const ProjectIntegrationTargetInputSchema = z.object({
  projectId: IntegrationProjectIdSchema,
});

/** Input of muggle-remote-slack-channel-set. */
export const SlackChannelSetInputSchema = z.object({
  projectId: IntegrationProjectIdSchema,
  channelId: z.string().min(1).describe("Slack channel ID from muggle-remote-slack-channel-list, e.g. 'C0123456789'"),
  channelName: z.string().min(1).optional().describe("Channel name to display, e.g. 'qa-reports'"),
});

/** Input of muggle-remote-github-config-set. */
export const GithubConfigSetInputSchema = z.object({
  projectId: IntegrationProjectIdSchema,
  owner: z.string().min(1).describe("Repository owner login from muggle-remote-github-repository-list"),
  repo: z.string().min(1).describe("Repository name from muggle-remote-github-repository-list"),
  pullRequestNumber: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Pull request to post reports on; omitting it clears any stored one"),
});
