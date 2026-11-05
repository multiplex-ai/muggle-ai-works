/* global require */
// Preloaded into a spawned install so one host fails name resolution in that process
// only. Everything above the resolver stays real: the fetch, the TUF client, sigstore.
const dns = require("node:dns");

const BLOCKED_HOST = "tuf-repo-cdn.sigstore.dev";
const originalLookup = dns.lookup;

dns.lookup = function lookupExceptBlockedHost(hostname, options, callback) {
  const lookupCallback = typeof options === "function" ? options : callback;
  const lookupOptions = typeof options === "function" ? {} : options;

  if (hostname !== BLOCKED_HOST) {
    return originalLookup.call(dns, hostname, lookupOptions, lookupCallback);
  }

  const errorCode = process.env.TRUST_ROOT_LOOKUP_ERROR_CODE;
  const lookupFailure = Object.assign(new Error(`lookup failed with ${errorCode} for ${hostname}`), {
    code: errorCode,
    hostname: hostname,
  });
  process.nextTick(() => lookupCallback(lookupFailure));
  return undefined;
};
