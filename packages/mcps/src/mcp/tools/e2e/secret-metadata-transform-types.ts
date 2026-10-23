/** One secret as the secret tools return it to an agent: its metadata, never its value. */
export interface ISecretMetadata {
  id: string;
  projectId: string;
  secretName: string;
  description?: string;
  source?: string;
  createdAt?: number;
  createdBy?: string;
  lastModifiedAt?: number;
  lastModifiedBy?: string;
  lastAccessedAt?: number;
  lastAccessedBy?: string;
}
