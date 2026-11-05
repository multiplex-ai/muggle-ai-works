/* global Response */
import dns from "node:dns";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createVerifier } from "sigstore";
import { describeErrorChain, isTrustRootUnreachable } from "../../scripts/release-integrity/classifyTrustRootFailure.mjs";

const realFetch = globalThis.fetch;
const VERIFIER_OPTIONS = {
    certificateIssuer: "https://token.actions.githubusercontent.com",
    certificateIdentityURI: "https://example.invalid/identity",
    retry: false,
};
const CACHE_ENV_NAMES = ["HOME", "USERPROFILE", "LOCALAPPDATA", "XDG_DATA_HOME"];

/** Listens on a free port and never answers, for a request that can only time out. */
async function startSilentServer() {
    const openSockets = new Set();
    const server = createServer((socket) => {
        openSockets.add(socket);
        socket.on("error", () => undefined);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    return {
        port: server.address().port,
        stop: async () => {
            openSockets.forEach((socket) => socket.destroy());
            await new Promise((resolve) => server.close(resolve));
        },
    };
}

/** Finds a port nothing is listening on. */
async function findClosedPort() {
    const silentServer = await startSilentServer();
    await silentServer.stop();
    return silentServer.port;
}

/** Loads the trust root through the real TUF client and returns what it rejects with. */
async function captureTrustRootFailure(extraOptions = {}) {
    return createVerifier({ ...VERIFIER_OPTIONS, ...extraOptions }).then(
        () => {
            throw new Error("expected the trust root load to fail");
        },
        (error) => error,
    );
}

/** Sends the real TUF client's requests to a local address through the real fetch. */
function routeTrustRootFetchesTo(url) {
    vi.stubGlobal("fetch", (_requestedUrl, requestOptions) => realFetch(url, requestOptions));
}

// These run the shipped sigstore client and the real fetch, so a dependency bump that
// reshapes what they reject with shows up here, not as customers locked out of installing.
describe("what the real TUF client rejects with", () => {
    const savedEnv = {};
    let cacheRoot;

    beforeAll(() => {
        cacheRoot = mkdtempSync(join(tmpdir(), "mgl-tuf-cache-"));
        for (const envName of CACHE_ENV_NAMES) {
            savedEnv[envName] = process.env[envName];
            process.env[envName] = cacheRoot;
        }
    });

    afterAll(() => {
        for (const envName of CACHE_ENV_NAMES) {
            if (savedEnv[envName] === undefined) {
                delete process.env[envName];
            } else {
                process.env[envName] = savedEnv[envName];
            }
        }
        rmSync(cacheRoot, { recursive: true, force: true });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("reads a real DNS failure as unreachable", async () => {
        vi.spyOn(dns, "lookup").mockImplementation((hostname, _options, callback) => {
            const lookupFailure = Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), {
                code: "ENOTFOUND",
                syscall: "getaddrinfo",
                hostname: hostname,
            });
            process.nextTick(() => callback(lookupFailure));
        });
        routeTrustRootFetchesTo("http://trust-root.test/");

        const trustRootFailure = await captureTrustRootFailure();

        expect(isTrustRootUnreachable(trustRootFailure)).toBe(true);
        expect(describeErrorChain(trustRootFailure)).toContain("ENOTFOUND");
    });

    it("reads a real connection refusal as unreachable", async () => {
        routeTrustRootFetchesTo(`http://127.0.0.1:${await findClosedPort()}/`);

        const trustRootFailure = await captureTrustRootFailure();

        expect(isTrustRootUnreachable(trustRootFailure)).toBe(true);
        expect(describeErrorChain(trustRootFailure)).toContain("ECONNREFUSED");
    });

    it("reads a real timeout as unreachable", async () => {
        const silentServer = await startSilentServer();
        routeTrustRootFetchesTo(`http://127.0.0.1:${silentServer.port}/`);

        const trustRootFailure = await captureTrustRootFailure({ timeout: 200 });
        await silentServer.stop();

        expect(isTrustRootUnreachable(trustRootFailure)).toBe(true);
    });

    it.each([
        ["HTTP 503", 503],
        ["HTTP 403", 403],
    ])("reads a real %s from the host as answered, not unreachable", async (_label, statusCode) => {
        vi.stubGlobal("fetch", async (requestedUrl) =>
            String(requestedUrl).includes("root.json")
                ? new Response("no newer root", { status: 404 })
                : new Response("refused", { status: statusCode }),
        );

        expect(isTrustRootUnreachable(await captureTrustRootFailure())).toBe(false);
    });

    it("reads a real captive portal page as answered, not unreachable", async () => {
        vi.stubGlobal("fetch", async (requestedUrl) =>
            String(requestedUrl).includes("root.json")
                ? new Response("no newer root", { status: 404 })
                : new Response("<html>sign in to the wifi</html>", { status: 200 }),
        );

        expect(isTrustRootUnreachable(await captureTrustRootFailure())).toBe(false);
    });
});
