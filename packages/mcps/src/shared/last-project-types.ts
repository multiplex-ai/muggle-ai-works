/** Shapes for the last-used Muggle Test project cache. */

/** A cached "last used project" record for a single working directory. */
export interface ILastProject {
  projectId: string;
  projectUrl: string;
  projectName: string;
  /** ISO-8601 timestamp of when this entry was last written. */
  savedAt: string;
}

/** Shape of the superseded in-project cache file. */
export interface ILastProjectFile {
  version: number;
  lastProject: ILastProject;
}
