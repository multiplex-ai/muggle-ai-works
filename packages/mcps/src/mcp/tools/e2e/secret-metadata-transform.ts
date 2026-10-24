/**
 * Keeps every secret tool's output to the secret's metadata. Fields are copied by name, so a
 * secret value never reaches the agent even from a backend that still sends one.
 */

import { GatewayError, McpErrorCode, type IUpstreamResponse } from "../../e2e/types.js";
import type {
  ISecretGroupListing,
  ISecretGroupMetadata,
  ISecretGroupSummary,
  ISecretMetadata,
} from "./secret-metadata-transform-types.js";

/**
 * Maps the project's secrets to their metadata.
 *
 * Output shape: `[{ id: "5e1c…", projectId: "9a7b…", secretName: "login_password", description: "Admin login", source: "user", createdAt: 1700000000000 }]`
 *
 * @throws GatewayError when the upstream body is not a list of secrets.
 */
export function mapSecretList(response: IUpstreamResponse): ISecretMetadata[] {
  if (!Array.isArray(response.data)) {
    throw new GatewayError({
      code: McpErrorCode.UPSTREAM_ERROR,
      message: `Secret list response was not an array (got ${typeof response.data}).`,
      statusCode: response.statusCode,
    });
  }
  return (response.data as ISecretMetadata[]).map(toSecretMetadata);
}

/**
 * Maps the one secret that get, create, update and delete return to its metadata.
 *
 * Output shape: `{ id: "5e1c…", projectId: "9a7b…", secretName: "login_password", description: "Admin login", source: "user", createdAt: 1700000000000 }`
 *
 * @throws GatewayError when the upstream body is not a single secret.
 */
export function mapSecret(response: IUpstreamResponse): ISecretMetadata {
  if (!isSingleObject(response.data)) {
    throw new GatewayError({
      code: McpErrorCode.UPSTREAM_ERROR,
      message: `Secret response was not a single secret (got ${describeUpstreamBody(response.data)}).`,
      statusCode: response.statusCode,
    });
  }
  return toSecretMetadata(response.data as unknown as ISecretMetadata);
}

/**
 * Maps a project's secret groups and ungrouped secrets to their metadata.
 *
 * Output shape: `{ groups: [{ group: { id: "1f2e…", groupName: "Visa test", secretType: "payment_card", … }, members: [{ field: "card_number", secret: { id: "5e1c…", secretName: "visa_test_card_number", groupId: "1f2e…", field: "card_number", … } }] }], adhocSecrets: [{ id: "7d3f…", secretName: "login_password", … }] }`
 *
 * @throws GatewayError when the upstream body is not a secret group listing.
 */
export function mapSecretGroupListing(response: IUpstreamResponse): ISecretGroupListing {
  const isGroupListing =
    isSingleObject(response.data) && Array.isArray(response.data.groups) && Array.isArray(response.data.adhocSecrets);
  if (!isGroupListing) {
    throw new GatewayError({
      code: McpErrorCode.UPSTREAM_ERROR,
      message: `Secret group list response was not { groups, adhocSecrets } (got ${describeUpstreamBody(response.data)}).`,
      statusCode: response.statusCode,
    });
  }
  const upstreamListing = response.data as unknown as ISecretGroupListing;
  return {
    groups: upstreamListing.groups.map(toSecretGroupSummary),
    adhocSecrets: upstreamListing.adhocSecrets.map(toSecretMetadata),
  };
}

/**
 * Maps the one secret group that create, update and delete return to its metadata.
 *
 * Output shape: `{ group: { id: "1f2e…", groupName: "Visa test", secretType: "payment_card", … }, members: [{ field: "card_number", secret: { id: "5e1c…", secretName: "visa_test_card_number", … } }] }`
 *
 * @throws GatewayError when the upstream body is not a single secret group.
 */
export function mapSecretGroupSummary(response: IUpstreamResponse): ISecretGroupSummary {
  const isGroupSummary =
    isSingleObject(response.data) && isSingleObject(response.data.group) && Array.isArray(response.data.members);
  if (!isGroupSummary) {
    throw new GatewayError({
      code: McpErrorCode.UPSTREAM_ERROR,
      message: `Secret group response was not { group, members } (got ${describeUpstreamBody(response.data)}).`,
      statusCode: response.statusCode,
    });
  }
  return toSecretGroupSummary(response.data as unknown as ISecretGroupSummary);
}

function isSingleObject(upstreamBody: unknown): upstreamBody is Record<string, unknown> {
  return typeof upstreamBody === "object" && upstreamBody !== null && !Array.isArray(upstreamBody);
}

function describeUpstreamBody(upstreamBody: unknown): string {
  return Array.isArray(upstreamBody) ? "array" : typeof upstreamBody;
}

function toSecretGroupSummary(upstreamSummary: ISecretGroupSummary): ISecretGroupSummary {
  return {
    group: toSecretGroupMetadata(upstreamSummary.group),
    members: upstreamSummary.members.map((upstreamMember) => ({
      field: upstreamMember.field,
      secret: toSecretMetadata(upstreamMember.secret),
    })),
  };
}

function toSecretGroupMetadata(upstreamGroup: ISecretGroupMetadata): ISecretGroupMetadata {
  return {
    id: upstreamGroup.id,
    projectId: upstreamGroup.projectId,
    secretType: upstreamGroup.secretType,
    groupName: upstreamGroup.groupName,
    description: upstreamGroup.description,
    createdAt: upstreamGroup.createdAt,
    createdBy: upstreamGroup.createdBy,
    lastModifiedAt: upstreamGroup.lastModifiedAt,
    lastModifiedBy: upstreamGroup.lastModifiedBy,
  };
}

function toSecretMetadata(upstreamSecret: ISecretMetadata): ISecretMetadata {
  return {
    id: upstreamSecret.id,
    projectId: upstreamSecret.projectId,
    secretName: upstreamSecret.secretName,
    description: upstreamSecret.description,
    source: upstreamSecret.source,
    groupId: upstreamSecret.groupId,
    field: upstreamSecret.field,
    createdAt: upstreamSecret.createdAt,
    createdBy: upstreamSecret.createdBy,
    lastModifiedAt: upstreamSecret.lastModifiedAt,
    lastModifiedBy: upstreamSecret.lastModifiedBy,
    lastAccessedAt: upstreamSecret.lastAccessedAt,
    lastAccessedBy: upstreamSecret.lastAccessedBy,
  };
}
