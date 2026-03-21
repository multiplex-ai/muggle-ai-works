/**
 * Supported skill execution environments.
 */
export type TSkillEnvironment = "local" | "remote" | "hybrid";

/**
 * Skill definition metadata.
 */
export interface ISkillDefinition {
  /**
   * Unique skill identifier.
   */
  skillId: string;
  /**
   * Display name for docs and UX.
   */
  displayName: string;
  /**
   * Runtime environment for the skill.
   */
  environment: TSkillEnvironment;
  /**
   * Optional human-readable description.
   */
  description?: string;
}
