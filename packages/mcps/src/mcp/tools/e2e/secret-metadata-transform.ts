/**
 * Keeps every secret tool's output to the secret's metadata. Fields are copied by name, so a
 * secret value never reaches the agent even from a backend that still sends one.
 */

import { GatewayError, McpErrorCode, type IUpstreamResponse } from "../../e2e/types.js";
import type { ISecretMetadata } from "./secret-metadata-transform-types.js";

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
  const isSingleSecret = typeof response.data === "object" && response.data !== null && !Array.isArray(response.data);
  if (!isSingleSecret) {
    throw new GatewayError({
      code: McpErrorCode.UPSTREAM_ERROR,
      message: `Secret response was not a single secret (got ${Array.isArray(response.data) ? "array" : typeof response.data}).`,
      statusCode: response.statusCode,
    });
  }
  return toSecretMetadata(response.data as ISecretMetadata);
}

function toSecretMetadata(upstreamSecret: ISecretMetadata): ISecretMetadata {
  return {
    id: upstreamSecret.id,
    projectId: upstreamSecret.projectId,
    secretName: upstreamSecret.secretName,
    description: upstreamSecret.description,
    source: upstreamSecret.source,
    createdAt: upstreamSecret.createdAt,
    createdBy: upstreamSecret.createdBy,
    lastModifiedAt: upstreamSecret.lastModifiedAt,
    lastModifiedBy: upstreamSecret.lastModifiedBy,
    lastAccessedAt: upstreamSecret.lastAccessedAt,
    lastAccessedBy: upstreamSecret.lastAccessedBy,
  };
}
