import type { IEntityReferenceField, ShortIdEntityTypeEnum } from "../../contracts/entity-reference-types.js";
import type { ICallerCredentials } from "../../e2e/types.js";

/**
 * Prompt-service's answer for one project short ID.
 *
 * Output shape: `{ entityType: "TEST_CASE", shortId: "TC-42", entityId: "<uuid>", isDeleted: false, useCaseId: "<uuid>" }`
 */
export interface IShortIdResolution {
  entityType: ShortIdEntityTypeEnum;
  /** Canonical form, e.g. `TC-42`. */
  shortId: string;
  entityId: string;
  /** True when the only entity carrying the short ID is soft-deleted. */
  isDeleted: boolean;
  useCaseId?: string;
  testCaseId?: string;
  testScriptId?: string;
  workflowRuntimeId?: string;
}

/** Arguments of resolveEntityReferencesAsync. */
export interface IResolveEntityReferencesParams {
  /** The reference fields the tool declares. */
  entityReferenceFields: IEntityReferenceField[];
  /** Tool input after schema validation. */
  input: Record<string, unknown>;
  credentials: ICallerCredentials;
  correlationId: string;
}
