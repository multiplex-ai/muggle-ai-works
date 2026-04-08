/**
 * Install identity for the muggle-ai-works MCP client.
 *
 * On first invocation, generates a random UUID and persists it to
 * ~/.muggle-ai/install-id.json. On subsequent runs, reads the existing file
 * and returns the persisted value. If the file is missing or malformed, a
 * fresh UUID is generated and written.
 *
 * The UUID is opaque and not linked to any user identity — it is a coarse
 * grouping key only, used by the backend's telemetry to count distinct
 * MCP installs per release in the fleet. Survives package updates; lost on
 * uninstall (or manual deletion of the file). Users can reset it by deleting
 * ~/.muggle-ai/install-id.json.
 *
 * The value is attached to every outbound backend HTTP call as the
 * X-Client-Install-Id header by PromptServiceClient.buildHeaders.
 */

import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";

import { getDataDir } from "./data-dir.js";

const INSTALL_ID_FILENAME = "install-id.json";

interface IInstallIdFile {
    installId: string;
}

let cachedInstallId: string | undefined;

function installIdFilePath(): string {
    return join(getDataDir(), INSTALL_ID_FILENAME);
}

function generateAndPersist(filePath: string): string {
    const installId = randomUUID();
    const contents: IInstallIdFile = { installId };
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(contents, null, 2) + "\n", "utf8");
    return installId;
}

function isValid(value: unknown): value is IInstallIdFile {
    return (
        typeof value === "object" &&
        value !== null &&
        typeof (value as { installId?: unknown }).installId === "string" &&
        (value as { installId: string }).installId.length > 0
    );
}

/**
 * Get the stable random install identifier for this MCP client install.
 * Returns a cached value on repeat calls within the same process.
 */
export function getInstallId(): string {
    if (cachedInstallId !== undefined) return cachedInstallId;

    const filePath = installIdFilePath();

    if (!existsSync(filePath)) {
        cachedInstallId = generateAndPersist(filePath);
        return cachedInstallId;
    }

    try {
        const raw = readFileSync(filePath, "utf8");
        const parsed: unknown = JSON.parse(raw);
        if (isValid(parsed)) {
            cachedInstallId = parsed.installId;
            return cachedInstallId;
        }
        // File exists but is malformed; regenerate.
        cachedInstallId = generateAndPersist(filePath);
        return cachedInstallId;
    } catch {
        // Unreadable — regenerate.
        cachedInstallId = generateAndPersist(filePath);
        return cachedInstallId;
    }
}

// For tests only. Do not call from production code.
export function resetInstallIdCacheForTests(): void {
    cachedInstallId = undefined;
}
