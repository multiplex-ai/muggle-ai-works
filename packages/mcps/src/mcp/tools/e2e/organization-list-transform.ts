/**
 * Slims the `my-organizations` response to what an agent needs to choose a
 * project's owner, leaving out billing identifiers, seat counts and timestamps.
 */

import type { IUpstreamResponse } from "../../e2e/types.js";
import type { IOrganizationListOutput, IRawMyOrganizationsEnvelope } from "./organization-list-transform-types.js";

/**
 * Maps the caller's memberships to one row per organization.
 *
 * Output shape: `{ organizations: [{ organizationId: "8f0c…", name: "Acme", status: "ACTIVE", role: "OWNER" }] }`
 */
export function mapOrganizationList(response: IUpstreamResponse): IOrganizationListOutput {
  const envelope = response.data as IRawMyOrganizationsEnvelope | undefined;
  const memberships = envelope?.organizations ?? [];
  return {
    organizations: memberships.map((membership) => ({
      organizationId: membership.organization.id,
      name: membership.organization.name,
      status: membership.organization.status,
      role: membership.role,
    })),
  };
}
