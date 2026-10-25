import { ProviderPrState } from "../guardrails/types.js";
import { PR_STATUS_BATCH_SIZE } from "./constants.js";
import { enumValueOf, optionalString } from "./field-parsers.js";
import {
  CiRollupState,
  PrMergeable,
  PrMergeStateStatus,
  type CommandRunner,
  type PrLiveStatus,
  type SlotPr,
} from "./types.js";

const PR_STATUS_FRAGMENT = `fragment WatchPr on PullRequest {
  state
  headRefOid
  mergeable
  mergeStateStatus
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
  reviewThreads(first: 100) { nodes { isResolved } }
}`;

interface PullRequestNode {
  state?: unknown;
  headRefOid?: unknown;
  mergeable?: unknown;
  mergeStateStatus?: unknown;
  commits?: { nodes?: Array<{ commit?: { statusCheckRollup?: { state?: unknown } | null } }> };
  reviewThreads?: { nodes?: Array<{ isResolved?: unknown }> };
}

/**
 * The GraphQL document and `gh api graphql` field flags for one batch. Owner,
 * name and number travel as typed variables, never spliced into the query, so a
 * hand-edited `prs.json` cannot change what is asked.
 */
export function buildPrStatusRequest(prs: SlotPr[]): string[] {
  const variableDeclarations: string[] = [];
  const selections: string[] = [];
  const fieldFlags: string[] = [];
  prs.forEach((pr, index) => {
    const [owner, name] = pr.repo.split("/");
    variableDeclarations.push(`$o${index}: String!, $r${index}: String!, $n${index}: Int!`);
    selections.push(`  p${index}: repository(owner: $o${index}, name: $r${index}) { pullRequest(number: $n${index}) { ...WatchPr } }`);
    fieldFlags.push("-f", `o${index}=${owner}`, "-f", `r${index}=${name}`, "-F", `n${index}=${pr.number}`);
  });
  const query = `query(${variableDeclarations.join(", ")}) {\n${selections.join("\n")}\n}\n${PR_STATUS_FRAGMENT}`;
  return ["api", "graphql", "-f", `query=${query}`, ...fieldFlags];
}

/** One PR's live status from its GraphQL node, or undefined when the node is missing or names no state. */
export function parsePullRequestNode(url: string, node: PullRequestNode | null | undefined): PrLiveStatus | undefined {
  const state = enumValueOf(ProviderPrState, node?.state);
  if (!node || state === undefined || state === ProviderPrState.Unreachable) return undefined;
  return {
    url: url,
    state: state,
    headSha: optionalString(node.headRefOid),
    mergeable: enumValueOf(PrMergeable, node.mergeable),
    mergeStateStatus: enumValueOf(PrMergeStateStatus, node.mergeStateStatus),
    ciRollup: enumValueOf(CiRollupState, node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state),
    unresolvedThreadCount: (node.reviewThreads?.nodes ?? []).filter((thread) => thread.isResolved === false).length,
  };
}

/**
 * Live status for every PR GitHub answered for, keyed by the slot's PR url. A PR
 * missing from the map could not be read this tick.
 */
export function fetchPrLiveStatuses(prs: SlotPr[], runCommand: CommandRunner): Map<string, PrLiveStatus> {
  const statusesByUrl = new Map<string, PrLiveStatus>();
  for (let start = 0; start < prs.length; start += PR_STATUS_BATCH_SIZE) {
    const batch = prs.slice(start, start + PR_STATUS_BATCH_SIZE);
    const outcome = runCommand("gh", buildPrStatusRequest(batch));
    if (!outcome?.stdout) continue;
    let response: { data?: Record<string, { pullRequest?: PullRequestNode | null } | null> };
    try {
      response = JSON.parse(outcome.stdout) as typeof response;
    } catch {
      continue;
    }
    batch.forEach((pr, index) => {
      const liveStatus = parsePullRequestNode(pr.url, response.data?.[`p${index}`]?.pullRequest);
      if (liveStatus) statusesByUrl.set(pr.url, liveStatus);
    });
  }
  return statusesByUrl;
}
