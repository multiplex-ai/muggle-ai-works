/** Reach of a test state fact; the string values are the prompt-service wire format. */
export enum TestStateFactScopeEnum {
  TEAM = "TEAM",
  ACCOUNT = "ACCOUNT",
}

/** Where a test role's accounts come from; the string values are the prompt-service wire format. */
export enum TestRoleSourceEnum {
  CREATED = "CREATED",
  SUPPLIED = "SUPPLIED",
}
