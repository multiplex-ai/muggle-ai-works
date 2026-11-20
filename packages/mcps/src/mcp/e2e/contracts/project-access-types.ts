/** Kind of principal a project access grant names; the string values are the prompt-service wire format. */
export enum ProjectAccessPrincipalTypeEnum {
  User = "USER",
  Team = "TEAM",
}

/** Role a project access grant or invitation gives; OWNER is excluded because ownership moves only by transfer. */
export enum ProjectAccessRoleEnum {
  Maintainer = "MAINTAINER",
  Editor = "EDITOR",
  Viewer = "VIEWER",
}
