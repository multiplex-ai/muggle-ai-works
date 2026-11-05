/* global DOMException */
import { TUFError } from "sigstore";

const TRUST_ROOT_HOST = "tuf-repo-cdn.sigstore.dev";
const TIMEOUT_MESSAGE = "The operation was aborted due to timeout";

/** One way loading the trust root can fail, as `[label, build the rejection]`. */
export type TrustRootFailureCase = [string, () => unknown];

/** A failed metadata refresh, as the TUF client reports it. */
export function metadataRefreshFailure(cause: unknown): TUFError {
  return new TUFError({ code: "TUF_REFRESH_METADATA_ERROR", message: "error refreshing TUF metadata", cause: cause });
}

/** A failed target download, as the TUF client reports it. */
export function targetDownloadFailure(cause: unknown): TUFError {
  return new TUFError({ code: "TUF_DOWNLOAD_TARGET_ERROR", message: "error downloading target undefined", cause: cause });
}

/** A socket or resolver error carrying a node error code. */
export function codedError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code: code });
}

/** The rejection fetch gives when a request never got a response. */
export function fetchFailed(cause: unknown): TypeError {
  return Object.assign(new TypeError("fetch failed"), { cause: cause });
}

/** The rejection an elapsed AbortSignal.timeout gives. */
export function abortTimeout(): DOMException {
  return new DOMException(TIMEOUT_MESSAGE, "TimeoutError");
}

/** The error the TUF client raises after flattening a mid-refresh failure into its message. */
export function flattenedFailure(step: string, flattenedError: string): Error {
  return new Error(`Unable to load ${step} error ${flattenedError}`);
}

/** The three failures the fallback exists for. */
export const CORE_UNREACHABLE_FAILURES: TrustRootFailureCase[] = [
  [
    "a DNS failure",
    () => metadataRefreshFailure(fetchFailed(codedError("ENOTFOUND", `getaddrinfo ENOTFOUND ${TRUST_ROOT_HOST}`))),
  ],
  [
    "a connection refusal",
    () => metadataRefreshFailure(fetchFailed(codedError("ECONNREFUSED", "connect ECONNREFUSED 127.0.0.1:443"))),
  ],
  ["a timeout", () => metadataRefreshFailure(abortTimeout())],
];

/** Every failure that must read as the host being out of reach. */
export const UNREACHABLE_FAILURES: TrustRootFailureCase[] = [
  ...CORE_UNREACHABLE_FAILURES,
  ["a temporary DNS failure", () => metadataRefreshFailure(fetchFailed(codedError("EAI_AGAIN", "getaddrinfo EAI_AGAIN")))],
  [
    "a refusal from every address of the host",
    () =>
      metadataRefreshFailure(
        fetchFailed(
          Object.assign(new AggregateError([codedError("ECONNREFUSED", "connect ECONNREFUSED ::1:443")], ""), {
            code: "ECONNREFUSED",
          }),
        ),
      ),
  ],
  ["a connection reset", () => metadataRefreshFailure(fetchFailed(codedError("ECONNRESET", "read ECONNRESET")))],
  ["a closed socket", () => metadataRefreshFailure(fetchFailed(codedError("UND_ERR_SOCKET", "other side closed")))],
  ["a socket timeout", () => metadataRefreshFailure(fetchFailed(codedError("ETIMEDOUT", "connect ETIMEDOUT")))],
  [
    "a connect timeout",
    () => metadataRefreshFailure(fetchFailed(codedError("UND_ERR_CONNECT_TIMEOUT", "Connect Timeout Error"))),
  ],
  ["an unreachable network", () => metadataRefreshFailure(fetchFailed(codedError("ENETUNREACH", "connect ENETUNREACH")))],
  ["an unreachable host", () => metadataRefreshFailure(fetchFailed(codedError("EHOSTUNREACH", "connect EHOSTUNREACH")))],
  ["a downed network", () => metadataRefreshFailure(fetchFailed(codedError("ENETDOWN", "connect ENETDOWN")))],
  [
    "a refusal while downloading the target",
    () => targetDownloadFailure(fetchFailed(codedError("ECONNREFUSED", "connect ECONNREFUSED 127.0.0.1:443"))),
  ],
  ["a timeout while downloading the target", () => targetDownloadFailure(abortTimeout())],
  [
    "a timeout the client flattened at the snapshot step",
    () => metadataRefreshFailure(flattenedFailure("snapshot metadata", `TimeoutError: ${TIMEOUT_MESSAGE}`)),
  ],
  [
    "a timeout the client flattened at the targets step",
    () => metadataRefreshFailure(flattenedFailure("targets", `TimeoutError: ${TIMEOUT_MESSAGE}`)),
  ],
];

/** Failures with no positive sign of an unreachable host, which must refuse. */
export const UNCLASSIFIABLE_FAILURES: TrustRootFailureCase[] = [
  [
    "a certificate for another host",
    () =>
      metadataRefreshFailure(
        fetchFailed(codedError("ERR_TLS_CERT_ALTNAME_INVALID", "Hostname/IP does not match certificate's altnames")),
      ),
  ],
  [
    "a self-signed certificate",
    () => metadataRefreshFailure(fetchFailed(codedError("DEPTH_ZERO_SELF_SIGNED_CERT", "self-signed certificate"))),
  ],
  [
    "HTTP 503 from the host",
    () => metadataRefreshFailure(Object.assign(new Error("Failed to download"), { statusCode: 503 })),
  ],
  [
    "HTTP 403 from the host",
    () => metadataRefreshFailure(Object.assign(new Error("Failed to download"), { statusCode: 403 })),
  ],
  [
    "a fetch failure the client flattened, which could be TLS",
    () => metadataRefreshFailure(flattenedFailure("snapshot metadata", "TypeError: fetch failed")),
  ],
  [
    "HTTP 503 the client flattened",
    () => metadataRefreshFailure(flattenedFailure("snapshot metadata", "Error: Failed to download")),
  ],
  [
    "a captive portal answering for the host",
    () => metadataRefreshFailure(new SyntaxError("Unexpected token '<', \"<html>capt\"... is not valid JSON")),
  ],
  [
    "invalid TUF metadata",
    () => metadataRefreshFailure(flattenedFailure("snapshot metadata", "Error: expected 'snapshot', got undefined")),
  ],
  ["a target failing its hash", () => targetDownloadFailure(new Error("Expected length 6787 but got 17"))],
  [
    "text that only starts like a flattened timeout",
    () =>
      metadataRefreshFailure(flattenedFailure("snapshot metadata", `TimeoutError: ${TIMEOUT_MESSAGE} and more besides`)),
  ],
  ["an abort that is not a timeout", () => metadataRefreshFailure(new DOMException("aborted", "AbortError"))],
  [
    "a local read of the cached target",
    () =>
      new TUFError({
        code: "TUF_READ_TARGET_ERROR",
        message: "error reading target",
        cause: codedError("EACCES", "permission denied"),
      }),
  ],
  [
    "a TUF failure that is not a fetch, even with a network cause",
    () =>
      new TUFError({
        code: "TUF_READ_TARGET_ERROR",
        message: "error reading target",
        cause: fetchFailed(codedError("ENOTFOUND", "getaddrinfo ENOTFOUND")),
      }),
  ],
  ["a missing target", () => new TUFError({ code: "TUF_FIND_TARGET_ERROR", message: "target not found" })],
  ["a cache that cannot start", () => new TUFError({ code: "TUF_INIT_CACHE_ERROR", message: "no root.json" })],
  ["a file system error", () => codedError("EACCES", "permission denied, mkdir")],
  ["a network code outside the TUF client", () => fetchFailed(codedError("ENOTFOUND", "getaddrinfo ENOTFOUND"))],
  ["a plain fetch failure", () => new Error("fetch failed")],
  ["an empty rejection", () => undefined],
];
