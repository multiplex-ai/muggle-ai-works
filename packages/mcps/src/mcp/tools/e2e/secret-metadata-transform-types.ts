import type { SecretFieldEnum, SecretTypeEnum } from "../../e2e/contracts/index.js";

/** One secret as the secret tools return it to an agent: its metadata, never its value. */
export interface ISecretMetadata {
  id: string;
  projectId: string;
  secretName: string;
  description?: string;
  source?: string;
  /** Secret group this secret is a member of; absent for an ad-hoc secret. */
  groupId?: string;
  /** Field this secret fills in its group; absent for an ad-hoc secret. */
  field?: SecretFieldEnum;
  createdAt?: number;
  createdBy?: string;
  lastModifiedAt?: number;
  lastModifiedBy?: string;
  lastAccessedAt?: number;
  lastAccessedBy?: string;
}

/** A typed secret group's own record, as the secret group tools return it. */
export interface ISecretGroupMetadata {
  id: string;
  projectId: string;
  secretType: SecretTypeEnum;
  groupName: string;
  description: string;
  createdAt?: number;
  createdBy?: string;
  lastModifiedAt?: number;
  lastModifiedBy?: string;
}

/** One member of a secret group: the field it fills and its secret's metadata. */
export interface ISecretGroupMemberMetadata {
  field: SecretFieldEnum;
  secret: ISecretMetadata;
}

/** A secret group with its members in field order, as create, update and delete return it. */
export interface ISecretGroupSummary {
  group: ISecretGroupMetadata;
  members: ISecretGroupMemberMetadata[];
}

/** A project's secret groups and its ungrouped user-provided secrets, as the group list returns them. */
export interface ISecretGroupListing {
  groups: ISecretGroupSummary[];
  adhocSecrets: ISecretMetadata[];
}
