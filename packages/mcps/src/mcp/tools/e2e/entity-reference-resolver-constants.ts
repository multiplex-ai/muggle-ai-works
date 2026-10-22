import {
  EntityReferenceResolvedFieldEnum,
  ShortIdEntityTypeEnum,
  type IEntityReferenceField,
} from "../../contracts/entity-reference-types.js";

/** Path segment, under a project, of prompt-service's short-ID resolver. */
export const SHORT_ID_ROUTE_SEGMENT = "short-ids";

/** How an error message names each entity type. */
export const SHORT_ID_ENTITY_NOUN_BY_TYPE: Record<ShortIdEntityTypeEnum, string> = {
  [ShortIdEntityTypeEnum.USE_CASE]: "use case",
  [ShortIdEntityTypeEnum.TEST_CASE]: "test case",
  [ShortIdEntityTypeEnum.TEST_SCRIPT]: "test script",
  [ShortIdEntityTypeEnum.REPLAY]: "replay",
};

/** A `useCaseId` input that takes a use case's full ID or short ID. */
export const USE_CASE_ID_REFERENCE_FIELD: IEntityReferenceField = {
  fieldName: "useCaseId",
  expectedEntityType: ShortIdEntityTypeEnum.USE_CASE,
  resolvedIdField: EntityReferenceResolvedFieldEnum.ENTITY_ID,
};

/** A `testCaseId` input that takes a test case's full ID or short ID. */
export const TEST_CASE_ID_REFERENCE_FIELD: IEntityReferenceField = {
  fieldName: "testCaseId",
  expectedEntityType: ShortIdEntityTypeEnum.TEST_CASE,
  resolvedIdField: EntityReferenceResolvedFieldEnum.ENTITY_ID,
};

/** A `testScriptId` input that takes a test script's full ID or short ID. */
export const TEST_SCRIPT_ID_REFERENCE_FIELD: IEntityReferenceField = {
  fieldName: "testScriptId",
  expectedEntityType: ShortIdEntityTypeEnum.TEST_SCRIPT,
  resolvedIdField: EntityReferenceResolvedFieldEnum.ENTITY_ID,
};

/**
 * A `workflowRuntimeId` input that takes a replay workflow runtime ID or a replay's short ID. The short ID names
 * one run, while the latest-run route is keyed by that run's workflow runtime.
 */
export const REPLAY_WORKFLOW_RUNTIME_ID_REFERENCE_FIELD: IEntityReferenceField = {
  fieldName: "workflowRuntimeId",
  expectedEntityType: ShortIdEntityTypeEnum.REPLAY,
  resolvedIdField: EntityReferenceResolvedFieldEnum.WORKFLOW_RUNTIME_ID,
};
