/**
 * Project storage service for local-first development.
 * Manages local file storage for projects, use cases, test cases, and test scripts.
 */

import * as fs from "fs";
import * as path from "path";
import { ulid } from "ulid";

import { getConfig } from "../../shared/config.js";
import { getLogger } from "../../shared/logger.js";
import type {
  ICloudIdMapping,
  ICreateLocalProjectRequest,
  ICreateLocalTestScriptParams,
  IDeleteLocalSecretParams,
  IDeleteLocalTestCaseParams,
  IDeleteLocalTestScriptParams,
  IDeleteLocalUseCaseParams,
  IDeleteLocalWorkflowFileParams,
  IGetCloudIdMappingParams,
  IGetLocalRunResultParams,
  IGetLocalSecretParams,
  IGetLocalTestCaseParams,
  IGetLocalTestScriptParams,
  IGetLocalTestScriptPathParams,
  IGetLocalUseCaseParams,
  IGetLocalWorkflowFileParams,
  IGetLocalWorkflowRunParams,
  IListLocalTestCasesParams,
  IListLocalTestScriptsParams,
  ILocalProject,
  ILocalRunResult,
  ILocalSecret,
  ILocalTestCase,
  ILocalTestScript,
  ILocalUseCase,
  ILocalWorkflowFile,
  ILocalWorkflowRun,
  IResolveLocalWorkflowFilesParams,
  ISaveCloudIdMappingParams,
  ISaveLocalActionScriptParams,
  ISaveLocalRunScreenshotParams,
  ISaveLocalSecretParams,
  ISaveLocalTestCaseRequest,
  ISaveLocalTestScriptScreenshotParams,
  ISaveLocalUseCaseRequest,
  ISaveLocalWorkflowFileParams,
  IUpdateCloudMappingParams,
  IUpdateLocalProjectRequest,
  IUpdateLocalRunResultParams,
  IUpdateLocalSecretParams,
  IUpdateLocalTestCaseParams,
  IUpdateLocalTestScriptParams,
  IUpdateLocalUseCaseParams,
  IUpdateLocalWorkflowFileParams,
  IUpdateLocalWorkflowRunParams,
} from "../types/index.js";
import { LocalTestScriptStatus, LocalWorkflowFileEntityType } from "../types/index.js";

/**
 * Service for managing local project storage.
 */
export class ProjectStorageService {
  /** Base projects directory. */
  private readonly projectsDir: string;

  /**
   * Create a new ProjectStorageService.
   */
  constructor() {
    const config = getConfig();
    this.projectsDir = config.localQa.projectsDir;
  }

  /**
   * Ensure the projects directory exists.
   */
  ensureProjectsDirectory(): void {
    const logger = getLogger();

    if (!fs.existsSync(this.projectsDir)) {
      fs.mkdirSync(this.projectsDir, { recursive: true });
      logger.info("Created projects directory", { path: this.projectsDir });
    }
  }

  /**
   * Generate a new project ID with prefix.
   */
  private generateProjectId(): string {
    return `proj_${ulid()}`;
  }

  /**
   * Generate a new use case ID with prefix.
   */
  private generateUseCaseId(): string {
    return `uc_${ulid()}`;
  }

  /**
   * Generate a new test case ID with prefix.
   */
  private generateTestCaseId(): string {
    return `tc_${ulid()}`;
  }

  /**
   * Generate a new test script ID with prefix.
   */
  private generateTestScriptId(): string {
    return `ts_${ulid()}`;
  }

  /**
   * Generate a new run ID with prefix.
   */
  private generateRunId(): string {
    return `run_${ulid()}`;
  }

  /**
   * Generate a new secret ID with prefix.
   */
  private generateSecretId(): string {
    return `sec_${ulid()}`;
  }

  /**
   * Generate a new workflow file ID with prefix.
   */
  private generateWorkflowFileId(): string {
    return `wf_${ulid()}`;
  }

  /**
   * Get the project directory path.
   * @param projectId - Project ID.
   */
  getProjectPath(projectId: string): string {
    return path.join(this.projectsDir, projectId);
  }

  /**
   * Get the secrets directory path for a project.
   */
  private getSecretsPath(projectId: string): string {
    return path.join(this.getProjectPath(projectId), "secrets");
  }

  /**
   * Get the workflow files directory path for a project.
   */
  private getWorkflowFilesPath(projectId: string): string {
    return path.join(this.getProjectPath(projectId), "workflow-files");
  }

  /**
   * Detect a basic MIME type from filename extension.
   */
  private detectMimeType(filename: string): string {
    const extension = path.extname(filename).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".csv": "text/csv",
      ".gif": "image/gif",
      ".jpeg": "image/jpeg",
      ".jpg": "image/jpeg",
      ".json": "application/json",
      ".pdf": "application/pdf",
      ".png": "image/png",
      ".txt": "text/plain",
      ".webp": "image/webp",
      ".xml": "application/xml",
    };

    return mimeTypes[extension] ?? "application/octet-stream";
  }

  // ========================================
  // Project Methods
  // ========================================

  /**
   * Create a new local project.
   */
  createProject(request: ICreateLocalProjectRequest): ILocalProject {
    const logger = getLogger();
    this.ensureProjectsDirectory();

    const projectId = this.generateProjectId();
    const projectDir = this.getProjectPath(projectId);
    const now = Date.now();

    const project: ILocalProject = {
      id: projectId,
      name: request.name,
      description: request.description,
      url: request.url,
      originalUrl: request.originalUrl,
      createdAt: now,
      updatedAt: now,
      cloudSource: request.cloudSource,
    };

    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(path.join(projectDir, "use-cases"), { recursive: true });
    fs.mkdirSync(path.join(projectDir, "test-cases"), { recursive: true });
    fs.mkdirSync(path.join(projectDir, "test-scripts"), { recursive: true });
    fs.mkdirSync(path.join(projectDir, "secrets"), { recursive: true });
    fs.mkdirSync(path.join(projectDir, "workflow-files"), { recursive: true });
    fs.mkdirSync(path.join(projectDir, "runs"), { recursive: true });

    const projectFilePath = path.join(projectDir, "project.json");
    fs.writeFileSync(projectFilePath, JSON.stringify(project, null, 2), "utf-8");

    logger.info("Created local project", { projectId: projectId, name: request.name });

    return project;
  }

  /**
   * Get a project by ID.
   */
  getProject(projectId: string): ILocalProject | null {
    const logger = getLogger();
    const projectFilePath = path.join(this.getProjectPath(projectId), "project.json");

    if (!fs.existsSync(projectFilePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(projectFilePath, "utf-8");
      return JSON.parse(content) as ILocalProject;
    } catch (error) {
      logger.error("Failed to load project", {
        projectId: projectId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * List all local projects.
   */
  listProjects(): ILocalProject[] {
    const logger = getLogger();

    if (!fs.existsSync(this.projectsDir)) {
      return [];
    }

    const projects: ILocalProject[] = [];
    const entries = fs.readdirSync(this.projectsDir);

    for (const entry of entries) {
      const projectPath = path.join(this.projectsDir, entry);
      const projectFilePath = path.join(projectPath, "project.json");

      if (fs.statSync(projectPath).isDirectory() && fs.existsSync(projectFilePath)) {
        try {
          const content = fs.readFileSync(projectFilePath, "utf-8");
          const project = JSON.parse(content) as ILocalProject;
          projects.push(project);
        } catch (error) {
          logger.warn("Failed to load project", {
            path: projectPath,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    projects.sort((a, b) => b.updatedAt - a.updatedAt);

    return projects;
  }

  /**
   * Update a project.
   */
  updateProject(request: IUpdateLocalProjectRequest): ILocalProject {
    const logger = getLogger();
    const existing = this.getProject(request.id);

    if (!existing) {
      throw new Error(`Project ${request.id} not found`);
    }

    const updated: ILocalProject = {
      ...existing,
      name: request.name ?? existing.name,
      description: request.description ?? existing.description,
      url: request.url ?? existing.url,
      originalUrl: request.originalUrl ?? existing.originalUrl,
      cloudProjectId: request.cloudProjectId ?? existing.cloudProjectId,
      lastPublishedAt: request.lastPublishedAt ?? existing.lastPublishedAt,
      cloudSource: request.cloudSource ?? existing.cloudSource,
      updatedAt: Date.now(),
    };

    const projectFilePath = path.join(this.getProjectPath(request.id), "project.json");
    fs.writeFileSync(projectFilePath, JSON.stringify(updated, null, 2), "utf-8");

    logger.info("Updated local project", { projectId: request.id });

    return updated;
  }

  /**
   * Delete a project and all its contents.
   */
  deleteProject(projectId: string): boolean {
    const logger = getLogger();
    const projectPath = this.getProjectPath(projectId);

    if (!fs.existsSync(projectPath)) {
      logger.warn("Project not found for deletion", { projectId: projectId });
      return false;
    }

    try {
      fs.rmSync(projectPath, { recursive: true, force: true });
      logger.info("Deleted local project", { projectId: projectId });
      return true;
    } catch (error) {
      logger.error("Failed to delete project", {
        projectId: projectId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  // ========================================
  // Secret Methods
  // ========================================

  /**
   * Save a local secret.
   */
  saveSecret(params: ISaveLocalSecretParams): ILocalSecret {
    const logger = getLogger();
    const project = this.getProject(params.projectId);
    if (!project) {
      throw new Error(`Project ${params.projectId} not found`);
    }

    const existingSecrets = this.listSecrets(params.projectId);
    const duplicateSecret = existingSecrets.find(
      (secret) => secret.secretName === params.secretName,
    );
    if (duplicateSecret) {
      throw new Error(`Secret with name ${params.secretName} already exists`);
    }

    const secretId = this.generateSecretId();
    const now = Date.now();
    const secret: ILocalSecret = {
      id: secretId,
      projectId: params.projectId,
      secretName: params.secretName,
      value: params.value,
      description: params.description,
      source: params.source,
      createdAt: now,
      updatedAt: now,
    };

    const secretsDir = this.getSecretsPath(params.projectId);
    if (!fs.existsSync(secretsDir)) {
      fs.mkdirSync(secretsDir, { recursive: true });
    }

    const secretFilePath = path.join(secretsDir, `${secretId}.json`);
    fs.writeFileSync(secretFilePath, JSON.stringify(secret, null, 2), "utf-8");
    logger.info("Saved local secret", { projectId: params.projectId, secretId: secretId });
    return secret;
  }

  /**
   * Get a local secret by ID.
   */
  getSecret(params: IGetLocalSecretParams): ILocalSecret | null {
    const logger = getLogger();
    const secretFilePath = path.join(
      this.getSecretsPath(params.projectId),
      `${params.secretId}.json`,
    );
    if (!fs.existsSync(secretFilePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(secretFilePath, "utf-8");
      return JSON.parse(content) as ILocalSecret;
    } catch (error) {
      logger.error("Failed to load secret", {
        projectId: params.projectId,
        secretId: params.secretId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * List local secrets for a project.
   */
  listSecrets(projectId: string): ILocalSecret[] {
    const logger = getLogger();
    const secretsDir = this.getSecretsPath(projectId);
    if (!fs.existsSync(secretsDir)) {
      return [];
    }

    const secrets: ILocalSecret[] = [];
    const files = fs.readdirSync(secretsDir).filter((file) => file.endsWith(".json"));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(secretsDir, file), "utf-8");
        secrets.push(JSON.parse(content) as ILocalSecret);
      } catch (error) {
        logger.warn("Failed to load secret file", {
          projectId: projectId,
          file: file,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    secrets.sort((a, b) => b.updatedAt - a.updatedAt);
    return secrets;
  }

  /**
   * Update a local secret.
   */
  updateSecret(params: IUpdateLocalSecretParams): ILocalSecret {
    const logger = getLogger();
    const existingSecret = this.getSecret({
      projectId: params.projectId,
      secretId: params.secretId,
    });
    if (!existingSecret) {
      throw new Error(`Secret ${params.secretId} not found`);
    }

    const updatedSecret: ILocalSecret = {
      ...existingSecret,
      ...params.updates,
      updatedAt: Date.now(),
    };

    const duplicateSecret = this.listSecrets(params.projectId).find(
      (secret) => secret.id !== params.secretId && secret.secretName === updatedSecret.secretName,
    );
    if (duplicateSecret) {
      throw new Error(`Secret with name ${updatedSecret.secretName} already exists`);
    }

    const secretFilePath = path.join(
      this.getSecretsPath(params.projectId),
      `${params.secretId}.json`,
    );
    fs.writeFileSync(secretFilePath, JSON.stringify(updatedSecret, null, 2), "utf-8");
    logger.info("Updated local secret", { projectId: params.projectId, secretId: params.secretId });
    return updatedSecret;
  }

  /**
   * Delete a local secret.
   */
  deleteSecret(params: IDeleteLocalSecretParams): boolean {
    const logger = getLogger();
    const secretFilePath = path.join(
      this.getSecretsPath(params.projectId),
      `${params.secretId}.json`,
    );
    if (!fs.existsSync(secretFilePath)) {
      logger.warn("Secret not found for deletion", {
        projectId: params.projectId,
        secretId: params.secretId,
      });
      return false;
    }

    try {
      fs.unlinkSync(secretFilePath);
      logger.info("Deleted local secret", {
        projectId: params.projectId,
        secretId: params.secretId,
      });
      return true;
    } catch (error) {
      logger.error("Failed to delete secret", {
        projectId: params.projectId,
        secretId: params.secretId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  // ========================================
  // Workflow File Methods
  // ========================================

  /**
   * Save a local workflow file.
   */
  saveWorkflowFile(params: ISaveLocalWorkflowFileParams): ILocalWorkflowFile {
    const logger = getLogger();
    const project = this.getProject(params.projectId);
    if (!project) {
      throw new Error(`Project ${params.projectId} not found`);
    }

    if (!fs.existsSync(params.sourceFilePath)) {
      throw new Error(`Workflow file source not found: ${params.sourceFilePath}`);
    }

    const fileId = this.generateWorkflowFileId();
    const now = Date.now();
    const filename = path.basename(params.sourceFilePath);
    const workflowFileDir = path.join(this.getWorkflowFilesPath(params.projectId), fileId);
    fs.mkdirSync(workflowFileDir, { recursive: true });

    const localPath = path.join(workflowFileDir, filename);
    fs.copyFileSync(params.sourceFilePath, localPath);
    const stats = fs.statSync(localPath);
    const associations = params.associations ?? [];
    const workflowFile: ILocalWorkflowFile = {
      id: fileId,
      projectId: params.projectId,
      filename: filename,
      description: params.description,
      mimeType: this.detectMimeType(filename),
      sizeBytes: stats.size,
      storageUrl: `file://${localPath}`,
      tags: params.tags ?? [],
      localPath: localPath,
      associations: associations,
      createdAt: now,
      updatedAt: now,
    };

    const metadataPath = path.join(workflowFileDir, "metadata.json");
    fs.writeFileSync(metadataPath, JSON.stringify(workflowFile, null, 2), "utf-8");
    logger.info("Saved local workflow file", {
      projectId: params.projectId,
      fileId: fileId,
      filename: filename,
    });
    return workflowFile;
  }

  /**
   * Get a local workflow file by ID.
   */
  getWorkflowFile(params: IGetLocalWorkflowFileParams): ILocalWorkflowFile | null {
    const logger = getLogger();
    const metadataPath = path.join(
      this.getWorkflowFilesPath(params.projectId),
      params.fileId,
      "metadata.json",
    );
    if (!fs.existsSync(metadataPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(metadataPath, "utf-8");
      return JSON.parse(content) as ILocalWorkflowFile;
    } catch (error) {
      logger.error("Failed to load workflow file", {
        projectId: params.projectId,
        fileId: params.fileId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * List local workflow files for a project.
   */
  listWorkflowFiles(projectId: string): ILocalWorkflowFile[] {
    const logger = getLogger();
    const workflowFilesDir = this.getWorkflowFilesPath(projectId);
    if (!fs.existsSync(workflowFilesDir)) {
      return [];
    }

    const workflowFiles: ILocalWorkflowFile[] = [];
    const entries = fs.readdirSync(workflowFilesDir);
    for (const entry of entries) {
      const metadataPath = path.join(workflowFilesDir, entry, "metadata.json");
      if (!fs.existsSync(metadataPath)) {
        continue;
      }

      try {
        const content = fs.readFileSync(metadataPath, "utf-8");
        workflowFiles.push(JSON.parse(content) as ILocalWorkflowFile);
      } catch (error) {
        logger.warn("Failed to load workflow file metadata", {
          projectId: projectId,
          entry: entry,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    workflowFiles.sort((a, b) => b.updatedAt - a.updatedAt);
    return workflowFiles;
  }

  /**
   * Update workflow file metadata.
   */
  updateWorkflowFile(params: IUpdateLocalWorkflowFileParams): ILocalWorkflowFile {
    const logger = getLogger();
    const existingFile = this.getWorkflowFile({
      projectId: params.projectId,
      fileId: params.fileId,
    });
    if (!existingFile) {
      throw new Error(`Workflow file ${params.fileId} not found`);
    }

    const updatedFile: ILocalWorkflowFile = {
      ...existingFile,
      ...params.updates,
      updatedAt: Date.now(),
    };

    const metadataPath = path.join(
      this.getWorkflowFilesPath(params.projectId),
      params.fileId,
      "metadata.json",
    );
    fs.writeFileSync(metadataPath, JSON.stringify(updatedFile, null, 2), "utf-8");
    logger.info("Updated local workflow file", {
      projectId: params.projectId,
      fileId: params.fileId,
    });
    return updatedFile;
  }

  /**
   * Delete a local workflow file.
   */
  deleteWorkflowFile(params: IDeleteLocalWorkflowFileParams): boolean {
    const logger = getLogger();
    const workflowFileDir = path.join(this.getWorkflowFilesPath(params.projectId), params.fileId);
    if (!fs.existsSync(workflowFileDir)) {
      logger.warn("Workflow file not found for deletion", {
        projectId: params.projectId,
        fileId: params.fileId,
      });
      return false;
    }

    try {
      fs.rmSync(workflowFileDir, { recursive: true, force: true });
      logger.info("Deleted local workflow file", {
        projectId: params.projectId,
        fileId: params.fileId,
      });
      return true;
    } catch (error) {
      logger.error("Failed to delete workflow file", {
        projectId: params.projectId,
        fileId: params.fileId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Resolve workflow files available for execution.
   */
  resolveWorkflowFilesForExecution(params: IResolveLocalWorkflowFilesParams): ILocalWorkflowFile[] {
    const workflowFiles = this.listWorkflowFiles(params.projectId);
    return workflowFiles.filter((workflowFile) => {
      if (!workflowFile.associations || workflowFile.associations.length === 0) {
        return true;
      }

      if (params.testCaseId) {
        const matchesTestCase = workflowFile.associations.some(
          (association) =>
            association.entityType === LocalWorkflowFileEntityType.TEST_CASE &&
            association.entityId === params.testCaseId,
        );
        if (matchesTestCase) {
          return true;
        }
      }

      if (params.useCaseId) {
        return workflowFile.associations.some(
          (association) =>
            association.entityType === LocalWorkflowFileEntityType.USE_CASE &&
            association.entityId === params.useCaseId,
        );
      }

      return false;
    });
  }

  // ========================================
  // Use Case Methods
  // ========================================

  /**
   * Save a use case.
   */
  saveUseCase(request: ISaveLocalUseCaseRequest): ILocalUseCase {
    const logger = getLogger();
    const project = this.getProject(request.projectId);

    if (!project) {
      throw new Error(`Project ${request.projectId} not found`);
    }

    const useCaseId = this.generateUseCaseId();
    const now = Date.now();

    const useCase: ILocalUseCase = {
      id: useCaseId,
      projectId: request.projectId,
      title: request.title,
      userStory: request.userStory,
      description: request.description,
      breakdownItems: request.breakdownItems,
      originalUrl: request.originalUrl,
      createdAt: now,
      updatedAt: now,
      cloudSource: request.cloudSource,
    };

    const useCasesDir = path.join(this.getProjectPath(request.projectId), "use-cases");
    if (!fs.existsSync(useCasesDir)) {
      fs.mkdirSync(useCasesDir, { recursive: true });
    }

    const useCaseFilePath = path.join(useCasesDir, `${useCaseId}.json`);
    fs.writeFileSync(useCaseFilePath, JSON.stringify(useCase, null, 2), "utf-8");

    logger.info("Saved local use case", { useCaseId: useCaseId, projectId: request.projectId });

    return useCase;
  }

  /**
   * Get a use case by ID.
   */
  getUseCase(params: IGetLocalUseCaseParams): ILocalUseCase | null {
    const logger = getLogger();
    const useCaseFilePath = path.join(
      this.getProjectPath(params.projectId),
      "use-cases",
      `${params.useCaseId}.json`,
    );

    if (!fs.existsSync(useCaseFilePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(useCaseFilePath, "utf-8");
      return JSON.parse(content) as ILocalUseCase;
    } catch (error) {
      logger.error("Failed to load use case", {
        useCaseId: params.useCaseId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * List use cases for a project.
   */
  listUseCases(projectId: string): ILocalUseCase[] {
    const logger = getLogger();
    const useCasesDir = path.join(this.getProjectPath(projectId), "use-cases");

    if (!fs.existsSync(useCasesDir)) {
      return [];
    }

    const useCases: ILocalUseCase[] = [];
    const files = fs.readdirSync(useCasesDir).filter((f) => f.endsWith(".json"));

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(useCasesDir, file), "utf-8");
        const useCase = JSON.parse(content) as ILocalUseCase;
        useCases.push(useCase);
      } catch (error) {
        logger.warn("Failed to load use case file", {
          file: file,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    useCases.sort((a, b) => b.updatedAt - a.updatedAt);

    return useCases;
  }

  /**
   * Update a use case.
   */
  updateUseCase(params: IUpdateLocalUseCaseParams): ILocalUseCase {
    const logger = getLogger();
    const existing = this.getUseCase({
      projectId: params.projectId,
      useCaseId: params.useCaseId,
    });

    if (!existing) {
      throw new Error(`Use case ${params.useCaseId} not found`);
    }

    const updated: ILocalUseCase = {
      ...existing,
      ...params.updates,
      updatedAt: Date.now(),
    };

    const useCaseFilePath = path.join(
      this.getProjectPath(params.projectId),
      "use-cases",
      `${params.useCaseId}.json`,
    );
    fs.writeFileSync(useCaseFilePath, JSON.stringify(updated, null, 2), "utf-8");

    logger.info("Updated local use case", { useCaseId: params.useCaseId });

    return updated;
  }

  /**
   * Delete a use case.
   */
  deleteUseCase(params: IDeleteLocalUseCaseParams): boolean {
    const logger = getLogger();
    const useCaseFilePath = path.join(
      this.getProjectPath(params.projectId),
      "use-cases",
      `${params.useCaseId}.json`,
    );

    if (!fs.existsSync(useCaseFilePath)) {
      logger.warn("Use case not found for deletion", { useCaseId: params.useCaseId });
      return false;
    }

    try {
      fs.unlinkSync(useCaseFilePath);
      logger.info("Deleted local use case", { useCaseId: params.useCaseId });
      return true;
    } catch (error) {
      logger.error("Failed to delete use case", {
        useCaseId: params.useCaseId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  // ========================================
  // Test Case Methods
  // ========================================

  /**
   * Save a test case.
   */
  saveTestCase(request: ISaveLocalTestCaseRequest): ILocalTestCase {
    const logger = getLogger();
    const project = this.getProject(request.projectId);

    if (!project) {
      throw new Error(`Project ${request.projectId} not found`);
    }

    const useCase = this.getUseCase({
      projectId: request.projectId,
      useCaseId: request.useCaseId,
    });

    if (!useCase) {
      throw new Error(`Use case ${request.useCaseId} not found`);
    }

    const testCaseId = this.generateTestCaseId();
    const now = Date.now();

    const testCase: ILocalTestCase = {
      id: testCaseId,
      projectId: request.projectId,
      useCaseId: request.useCaseId,
      title: request.title,
      description: request.description,
      goal: request.goal,
      precondition: request.precondition,
      instructions: request.instructions,
      expectedResult: request.expectedResult,
      url: request.url,
      originalUrl: request.originalUrl,
      createdAt: now,
      updatedAt: now,
      cloudSource: request.cloudSource,
    };

    const testCasesDir = path.join(this.getProjectPath(request.projectId), "test-cases");
    if (!fs.existsSync(testCasesDir)) {
      fs.mkdirSync(testCasesDir, { recursive: true });
    }

    const testCaseFilePath = path.join(testCasesDir, `${testCaseId}.json`);
    fs.writeFileSync(testCaseFilePath, JSON.stringify(testCase, null, 2), "utf-8");

    logger.info("Saved local test case", {
      testCaseId: testCaseId,
      useCaseId: request.useCaseId,
    });

    return testCase;
  }

  /**
   * Get a test case by ID.
   */
  getTestCase(params: IGetLocalTestCaseParams): ILocalTestCase | null {
    const logger = getLogger();
    const testCaseFilePath = path.join(
      this.getProjectPath(params.projectId),
      "test-cases",
      `${params.testCaseId}.json`,
    );

    if (!fs.existsSync(testCaseFilePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(testCaseFilePath, "utf-8");
      return JSON.parse(content) as ILocalTestCase;
    } catch (error) {
      logger.error("Failed to load test case", {
        testCaseId: params.testCaseId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * List test cases.
   */
  listTestCases(params: IListLocalTestCasesParams): ILocalTestCase[] {
    const logger = getLogger();
    const testCasesDir = path.join(this.getProjectPath(params.projectId), "test-cases");

    if (!fs.existsSync(testCasesDir)) {
      return [];
    }

    const testCases: ILocalTestCase[] = [];
    const files = fs.readdirSync(testCasesDir).filter((f) => f.endsWith(".json"));

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(testCasesDir, file), "utf-8");
        const testCase = JSON.parse(content) as ILocalTestCase;

        if (!params.useCaseId || testCase.useCaseId === params.useCaseId) {
          testCases.push(testCase);
        }
      } catch (error) {
        logger.warn("Failed to load test case file", {
          file: file,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    testCases.sort((a, b) => b.updatedAt - a.updatedAt);

    return testCases;
  }

  /**
   * Update a test case.
   */
  updateTestCase(params: IUpdateLocalTestCaseParams): ILocalTestCase {
    const logger = getLogger();
    const existing = this.getTestCase({
      projectId: params.projectId,
      testCaseId: params.testCaseId,
    });

    if (!existing) {
      throw new Error(`Test case ${params.testCaseId} not found`);
    }

    const updated: ILocalTestCase = {
      ...existing,
      ...params.updates,
      updatedAt: Date.now(),
    };

    const testCaseFilePath = path.join(
      this.getProjectPath(params.projectId),
      "test-cases",
      `${params.testCaseId}.json`,
    );
    fs.writeFileSync(testCaseFilePath, JSON.stringify(updated, null, 2), "utf-8");

    logger.info("Updated local test case", { testCaseId: params.testCaseId });

    return updated;
  }

  /**
   * Delete a test case.
   */
  deleteTestCase(params: IDeleteLocalTestCaseParams): boolean {
    const logger = getLogger();
    const testCaseFilePath = path.join(
      this.getProjectPath(params.projectId),
      "test-cases",
      `${params.testCaseId}.json`,
    );

    if (!fs.existsSync(testCaseFilePath)) {
      logger.warn("Test case not found for deletion", { testCaseId: params.testCaseId });
      return false;
    }

    try {
      fs.unlinkSync(testCaseFilePath);
      logger.info("Deleted local test case", { testCaseId: params.testCaseId });
      return true;
    } catch (error) {
      logger.error("Failed to delete test case", {
        testCaseId: params.testCaseId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  // ========================================
  // Test Script Methods
  // ========================================

  /**
   * Create a test script entry.
   */
  createTestScript(params: ICreateLocalTestScriptParams): ILocalTestScript {
    const logger = getLogger();
    const testScriptId = params.testScriptId ?? this.generateTestScriptId();
    const now = Date.now();
    const testScriptDir = path.join(
      this.getProjectPath(params.projectId),
      "test-scripts",
      testScriptId,
    );

    if (fs.existsSync(testScriptDir)) {
      throw new Error(`Test script already exists: ${testScriptId}`);
    }

    const testScript: ILocalTestScript = {
      id: testScriptId,
      projectId: params.projectId,
      useCaseId: params.useCaseId,
      testCaseId: params.testCaseId,
      name: params.name ?? `Test Script for ${params.testCaseId}`,
      url: params.url,
      status: LocalTestScriptStatus.DRAFT,
      createdAt: now,
      updatedAt: now,
    };

    fs.mkdirSync(testScriptDir, { recursive: true });
    fs.mkdirSync(path.join(testScriptDir, "screenshots"), { recursive: true });

    const testScriptFilePath = path.join(testScriptDir, "script.json");
    fs.writeFileSync(testScriptFilePath, JSON.stringify(testScript, null, 2), "utf-8");

    logger.info("Created local test script", {
      testScriptId: testScriptId,
      testCaseId: params.testCaseId,
    });

    return testScript;
  }

  /**
   * Get a test script by ID.
   */
  getTestScript(params: IGetLocalTestScriptParams): ILocalTestScript | null {
    const logger = getLogger();
    const testScriptFilePath = path.join(
      this.getProjectPath(params.projectId),
      "test-scripts",
      params.testScriptId,
      "script.json",
    );

    if (!fs.existsSync(testScriptFilePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(testScriptFilePath, "utf-8");
      return JSON.parse(content) as ILocalTestScript;
    } catch (error) {
      logger.error("Failed to load test script", {
        testScriptId: params.testScriptId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * List test scripts for a project.
   */
  listTestScripts(params: IListLocalTestScriptsParams): ILocalTestScript[] {
    const logger = getLogger();
    const testScriptsDir = path.join(this.getProjectPath(params.projectId), "test-scripts");

    if (!fs.existsSync(testScriptsDir)) {
      return [];
    }

    const testScripts: ILocalTestScript[] = [];
    const entries = fs.readdirSync(testScriptsDir);

    for (const entry of entries) {
      const entryPath = path.join(testScriptsDir, entry);
      const scriptFilePath = path.join(entryPath, "script.json");

      if (fs.statSync(entryPath).isDirectory() && fs.existsSync(scriptFilePath)) {
        try {
          const content = fs.readFileSync(scriptFilePath, "utf-8");
          const testScript = JSON.parse(content) as ILocalTestScript;

          if (!params.testCaseId || testScript.testCaseId === params.testCaseId) {
            testScripts.push(testScript);
          }
        } catch (error) {
          logger.warn("Failed to load test script", {
            path: scriptFilePath,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    testScripts.sort((a, b) => b.updatedAt - a.updatedAt);

    return testScripts;
  }

  /**
   * Delete a test script.
   */
  deleteTestScript(params: IDeleteLocalTestScriptParams): boolean {
    const logger = getLogger();
    const testScriptDir = path.join(
      this.getProjectPath(params.projectId),
      "test-scripts",
      params.testScriptId,
    );

    if (!fs.existsSync(testScriptDir)) {
      return false;
    }

    fs.rmSync(testScriptDir, { recursive: true, force: true });

    logger.info("Deleted local test script", { testScriptId: params.testScriptId });

    return true;
  }

  /**
   * Update a test script.
   */
  updateTestScript(params: IUpdateLocalTestScriptParams): ILocalTestScript {
    const logger = getLogger();
    const existing = this.getTestScript({
      projectId: params.projectId,
      testScriptId: params.testScriptId,
    });

    if (!existing) {
      throw new Error(`Test script ${params.testScriptId} not found`);
    }

    const updated: ILocalTestScript = {
      ...existing,
      ...params.updates,
      updatedAt: Date.now(),
    };

    const testScriptFilePath = path.join(
      this.getProjectPath(params.projectId),
      "test-scripts",
      params.testScriptId,
      "script.json",
    );
    fs.writeFileSync(testScriptFilePath, JSON.stringify(updated, null, 2), "utf-8");

    logger.info("Updated local test script", { testScriptId: params.testScriptId });

    return updated;
  }

  /**
   * Get the test script directory path.
   */
  getTestScriptPath(params: IGetLocalTestScriptPathParams): string {
    return path.join(this.getProjectPath(params.projectId), "test-scripts", params.testScriptId);
  }

  /**
   * Save action script to test script directory.
   */
  saveActionScript(params: ISaveLocalActionScriptParams): string {
    const logger = getLogger();
    const testScriptDir = this.getTestScriptPath({
      projectId: params.projectId,
      testScriptId: params.testScriptId,
    });

    const actionScriptPath = path.join(testScriptDir, "action-script.json");
    fs.writeFileSync(actionScriptPath, JSON.stringify(params.actionScript, null, 2), "utf-8");

    logger.info("Saved action script", { testScriptId: params.testScriptId });

    return actionScriptPath;
  }

  /**
   * Save screenshot to test script directory.
   */
  saveTestScriptScreenshot(params: ISaveLocalTestScriptScreenshotParams): string {
    const logger = getLogger();
    const screenshotDir = path.join(
      this.getTestScriptPath({
        projectId: params.projectId,
        testScriptId: params.testScriptId,
      }),
      "screenshots",
    );

    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    const screenshotPath = path.join(screenshotDir, params.filename);
    fs.writeFileSync(screenshotPath, params.data);

    logger.debug("Saved test script screenshot", {
      testScriptId: params.testScriptId,
      filename: params.filename,
    });

    return screenshotPath;
  }

  // ========================================
  // Run Result Methods
  // ========================================

  /**
   * Create a run result entry.
   */
  createRunResult(runResult: ILocalRunResult): ILocalRunResult {
    const logger = getLogger();
    const runDir = path.join(this.getProjectPath(runResult.projectId), "runs", runResult.id);

    fs.mkdirSync(runDir, { recursive: true });
    fs.mkdirSync(path.join(runDir, "screenshots"), { recursive: true });

    const runFilePath = path.join(runDir, "result.json");
    fs.writeFileSync(runFilePath, JSON.stringify(runResult, null, 2), "utf-8");

    logger.info("Created local run result", { runId: runResult.id });

    return runResult;
  }

  /**
   * List run results for a project.
   */
  listRunResults(projectId: string): ILocalRunResult[] {
    const logger = getLogger();
    const runsDir = path.join(this.getProjectPath(projectId), "runs");

    if (!fs.existsSync(runsDir)) {
      return [];
    }

    const runResults: ILocalRunResult[] = [];
    const entries = fs.readdirSync(runsDir);

    for (const entry of entries) {
      const entryPath = path.join(runsDir, entry);
      const resultFilePath = path.join(entryPath, "result.json");

      if (fs.statSync(entryPath).isDirectory() && fs.existsSync(resultFilePath)) {
        try {
          const content = fs.readFileSync(resultFilePath, "utf-8");
          const runResult = JSON.parse(content) as ILocalRunResult;
          runResults.push(runResult);
        } catch (error) {
          logger.warn("Failed to load run result", {
            path: resultFilePath,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return runResults;
  }

  /**
   * Get a run result by ID.
   */
  getRunResult(params: IGetLocalRunResultParams): ILocalRunResult | null {
    const logger = getLogger();
    const runFilePath = path.join(
      this.getProjectPath(params.projectId),
      "runs",
      params.runId,
      "result.json",
    );

    if (!fs.existsSync(runFilePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(runFilePath, "utf-8");
      return JSON.parse(content) as ILocalRunResult;
    } catch (error) {
      logger.error("Failed to load run result", {
        runId: params.runId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Update a run result.
   */
  updateRunResult(params: IUpdateLocalRunResultParams): ILocalRunResult {
    const logger = getLogger();
    const existing = this.getRunResult({
      projectId: params.projectId,
      runId: params.runId,
    });

    if (!existing) {
      throw new Error(`Run ${params.runId} not found`);
    }

    const updated: ILocalRunResult = {
      ...existing,
      ...params.updates,
    };

    const runFilePath = path.join(
      this.getProjectPath(params.projectId),
      "runs",
      params.runId,
      "result.json",
    );
    fs.writeFileSync(runFilePath, JSON.stringify(updated, null, 2), "utf-8");

    logger.info("Updated local run result", { runId: params.runId });

    return updated;
  }

  /**
   * Save screenshot to run directory.
   */
  saveRunScreenshot(params: ISaveLocalRunScreenshotParams): string {
    const logger = getLogger();
    const screenshotDir = path.join(
      this.getProjectPath(params.projectId),
      "runs",
      params.runId,
      "screenshots",
    );

    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    const screenshotPath = path.join(screenshotDir, params.filename);
    fs.writeFileSync(screenshotPath, params.data);

    logger.debug("Saved run screenshot", {
      runId: params.runId,
      filename: params.filename,
    });

    return screenshotPath;
  }

  // ========================================
  // Workflow Run Methods
  // ========================================

  /**
   * Create a workflow run entry.
   */
  createWorkflowRun(workflowRun: ILocalWorkflowRun): ILocalWorkflowRun {
    const logger = getLogger();
    const workflowRunsDir = path.join(this.getProjectPath(workflowRun.projectId), "workflow-runs");

    fs.mkdirSync(workflowRunsDir, { recursive: true });

    const workflowRunFilePath = path.join(workflowRunsDir, `${workflowRun.id}.json`);
    fs.writeFileSync(workflowRunFilePath, JSON.stringify(workflowRun, null, 2), "utf-8");

    logger.info("Created local workflow run", {
      workflowRunId: workflowRun.id,
      projectId: workflowRun.projectId,
    });

    return workflowRun;
  }

  /**
   * Get a workflow run by ID.
   */
  getWorkflowRun(params: IGetLocalWorkflowRunParams): ILocalWorkflowRun | null {
    const logger = getLogger();
    const workflowRunFilePath = path.join(
      this.getProjectPath(params.projectId),
      "workflow-runs",
      `${params.workflowRunId}.json`,
    );

    if (!fs.existsSync(workflowRunFilePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(workflowRunFilePath, "utf-8");
      return JSON.parse(content) as ILocalWorkflowRun;
    } catch (error) {
      logger.error("Failed to load workflow run", {
        workflowRunId: params.workflowRunId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Update a workflow run.
   */
  updateWorkflowRun(params: IUpdateLocalWorkflowRunParams): ILocalWorkflowRun {
    const logger = getLogger();
    const existing = this.getWorkflowRun({
      projectId: params.projectId,
      workflowRunId: params.workflowRunId,
    });

    if (!existing) {
      throw new Error(`Workflow run ${params.workflowRunId} not found`);
    }

    const updated: ILocalWorkflowRun = {
      ...existing,
      ...params.updates,
    };

    const workflowRunFilePath = path.join(
      this.getProjectPath(params.projectId),
      "workflow-runs",
      `${params.workflowRunId}.json`,
    );
    fs.writeFileSync(workflowRunFilePath, JSON.stringify(updated, null, 2), "utf-8");

    logger.info("Updated local workflow run", { workflowRunId: params.workflowRunId });

    return updated;
  }

  // ========================================
  // Cloud ID Mapping Methods
  // ========================================

  /**
   * Update cloud ID mapping.
   */
  updateCloudMapping(params: IUpdateCloudMappingParams): void {
    const logger = getLogger();
    const mappingsDir = path.join(this.projectsDir, "_mappings");

    if (!fs.existsSync(mappingsDir)) {
      fs.mkdirSync(mappingsDir, { recursive: true });
    }

    const mappingsFilePath = path.join(mappingsDir, "cloud-id-mappings.json");
    let mappings: Array<{ localId: string; cloudId: string; entityType: string }> = [];

    if (fs.existsSync(mappingsFilePath)) {
      try {
        const content = fs.readFileSync(mappingsFilePath, "utf-8");
        mappings = JSON.parse(content);
      } catch {
        mappings = [];
      }
    }

    const existingIndex = mappings.findIndex(
      (m) => m.localId === params.localId && m.entityType === params.entityType,
    );

    if (existingIndex >= 0) {
      mappings[existingIndex] = {
        localId: params.localId,
        cloudId: params.cloudId,
        entityType: params.entityType,
      };
    } else {
      mappings.push({
        localId: params.localId,
        cloudId: params.cloudId,
        entityType: params.entityType,
      });
    }

    fs.writeFileSync(mappingsFilePath, JSON.stringify(mappings, null, 2), "utf-8");

    logger.debug("Updated cloud ID mapping", {
      localId: params.localId,
      cloudId: params.cloudId,
      entityType: params.entityType,
    });
  }

  /**
   * Save cloud ID mapping.
   */
  saveCloudIdMapping(params: ISaveCloudIdMappingParams): void {
    const logger = getLogger();
    const mappingsDir = path.join(this.getProjectPath(params.projectId), "mappings");

    if (!fs.existsSync(mappingsDir)) {
      fs.mkdirSync(mappingsDir, { recursive: true });
    }

    const mappingsFilePath = path.join(mappingsDir, "cloud-id-mappings.json");
    let mappings: ICloudIdMapping[] = [];

    if (fs.existsSync(mappingsFilePath)) {
      try {
        const content = fs.readFileSync(mappingsFilePath, "utf-8");
        mappings = JSON.parse(content) as ICloudIdMapping[];
      } catch {
        mappings = [];
      }
    }

    const existingIndex = mappings.findIndex(
      (m) => m.localId === params.mapping.localId && m.entityType === params.mapping.entityType,
    );

    if (existingIndex >= 0) {
      mappings[existingIndex] = params.mapping;
    } else {
      mappings.push(params.mapping);
    }

    fs.writeFileSync(mappingsFilePath, JSON.stringify(mappings, null, 2), "utf-8");

    logger.debug("Saved cloud ID mapping", {
      localId: params.mapping.localId,
      cloudId: params.mapping.cloudId,
      entityType: params.mapping.entityType,
    });
  }

  /**
   * Get cloud ID mapping for a local entity.
   */
  getCloudIdMapping(params: IGetCloudIdMappingParams): string | null {
    const mappingsFilePath = path.join(
      this.getProjectPath(params.projectId),
      "mappings",
      "cloud-id-mappings.json",
    );

    if (!fs.existsSync(mappingsFilePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(mappingsFilePath, "utf-8");
      const mappings = JSON.parse(content) as ICloudIdMapping[];
      const mapping = mappings.find(
        (m) => m.localId === params.localId && m.entityType === params.entityType,
      );
      return mapping?.cloudId ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Get the projects directory path.
   */
  getProjectsDir(): string {
    return this.projectsDir;
  }

  /**
   * Generate a new run ID.
   */
  generateNewRunId(): string {
    return this.generateRunId();
  }
}

/** Cached service instance. */
let serviceInstance: ProjectStorageService | null = null;

/**
 * Get the singleton ProjectStorageService instance.
 */
export function getProjectStorageService(): ProjectStorageService {
  serviceInstance ??= new ProjectStorageService();
  return serviceInstance;
}

/**
 * Reset the service (for testing).
 */
export function resetProjectStorageService(): void {
  serviceInstance = null;
}
