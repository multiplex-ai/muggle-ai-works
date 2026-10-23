/** Entity types that carry a project short ID; members match prompt-service. */
export enum ShortIdEntityTypeEnum {
  USE_CASE = "USE_CASE",
  TEST_CASE = "TEST_CASE",
  TEST_SCRIPT = "TEST_SCRIPT",
  REPLAY = "REPLAY",
}

/** The resolution field whose value replaces a short ID in a tool input. */
export enum EntityReferenceResolvedFieldEnum {
  ENTITY_ID = "entityId",
  WORKFLOW_RUNTIME_ID = "workflowRuntimeId",
}

/** A tool input field that takes a full ID or a short ID of one entity type. */
export interface IEntityReferenceField {
  fieldName: string;
  expectedEntityType: ShortIdEntityTypeEnum;
  resolvedIdField: EntityReferenceResolvedFieldEnum;
}
