/** One membership row from `GET /v1/protected/organizations/my-organizations`. */
export interface IRawMyOrganizationEntry {
  organization: { id: string; name: string; status: string };
  role: string;
}

/** Body of `GET /v1/protected/organizations/my-organizations`. */
export interface IRawMyOrganizationsEnvelope {
  organizations?: IRawMyOrganizationEntry[];
}

/** One organization the caller belongs to, as muggle-remote-organization-list returns it. */
export interface IOrganizationListRow {
  organizationId: string;
  name: string;
  status: string;
  role: string;
}

/** Output of muggle-remote-organization-list. */
export interface IOrganizationListOutput {
  organizations: IOrganizationListRow[];
}
