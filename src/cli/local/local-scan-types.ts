/** Options accepted by `muggle scan`, as Commander hands them over. */
export interface ILocalScanCommandOptions {
  /** Run the scan in the local Studio; the only mode the CLI offers. */
  local?: boolean;
  /** Cloud project the candidates belong to. */
  projectId: string;
  /** Site URL the scan starts from. */
  url: string;
  /** Candidate count at which the scan stops. */
  maxCandidates?: string;
  /** Longest the scan runs before it is stopped. */
  timeoutMs?: string;
  /** Show the Studio window. */
  showUi?: boolean;
  /** Print the one-line JSON report instead of text. */
  json?: boolean;
}

/** How a local scan ended, as the JSON report states it. */
export enum LocalScanStatusEnum {
  /** Studio ended the scan on its own before reaching the candidate cap. */
  Finished = "finished",
  /** The scan stopped at `--max-candidates` or `--timeout-ms`, keeping what it found. */
  Capped = "capped",
  /** The scan could not run or Studio failed; `error` says why. */
  Error = "error",
}

/** One use-case candidate in the report. */
export interface ILocalScanCandidate {
  title: string;
  description: string;
  /** Page the use case starts on. */
  startUrl: string;
  /** Whether the candidate's text says the flow runs signed in. */
  requiresSignIn: boolean;
}

/**
 * The one JSON line `muggle scan --local --json` prints.
 *
 * Output shape:
 * `{"status":"capped","candidates":[{"title":"Search the catalog","description":"...","startUrl":"https://example.com","requiresSignIn":false}],"durationMs":412000,"error":null}`
 */
export interface ILocalScanReport {
  status: LocalScanStatusEnum;
  candidates: ILocalScanCandidate[];
  durationMs: number;
  error: string | null;
}

/** The fields of a stored use case a scan report reads. */
export interface IDiscoveredUseCase {
  title?: string;
  description?: string;
  userStory?: string;
  url?: string;
  useCaseBreakdown?: unknown[];
}

/** One candidate as the discovery memory stores it. */
export interface IDiscoveryMemoryCandidate {
  id: string;
  status: string;
  createdAt?: number;
  useCase: IDiscoveredUseCase;
}

/** A project's use-case discovery memory, as `muggle-remote-use-case-discovery-memory-get` returns it. */
export interface IDiscoveryMemory {
  id: string;
  useCaseCandidates?: IDiscoveryMemoryCandidate[];
}

/** Response body of `muggle-remote-use-case-discovery-memory-get`. */
export interface IDiscoveryMemoryResponse {
  memory: IDiscoveryMemory | null;
}

/** Parsed and validated scan limits. */
export interface ILocalScanLimits {
  maxCandidates: number;
  timeoutMs: number;
}
