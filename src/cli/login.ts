/**
 * Login/logout/status commands for authentication.
 */

import {
  assertDeviceCodeClientProvisioned,
  getActiveRuntimeTarget,
  getAuthService,
  getConfig,
  getLogger,
  hasApiKey,
  performLogin,
  performLogout,
} from "../../packages/mcps/src/index.js";

const logger = getLogger();

/**
 * Options for the login command.
 */
export interface ILoginOptions {
  /** Name for the API key. */
  keyName?: string;
  /** API key expiry: 30d, 90d, 1y, never. */
  keyExpiry?: string;
}

/**
 * Execute the login command.
 * @param options - Command options.
 */
export async function loginCommand (options: ILoginOptions): Promise<void> {
  console.log("\nMuggle AI Login");
  console.log("===============\n");

  // Fail before contacting Auth0: an unprovisioned client comes back as an
  // opaque 403 that says nothing about which target is misconfigured.
  assertDeviceCodeClientProvisioned(getActiveRuntimeTarget());

  const expiry = (options.keyExpiry || "90d") as "30d" | "90d" | "1y" | "never";

  console.log("Starting device code authentication...");
  console.log("A browser window will open for you to complete login.\n");

  const loginResult = await performLogin(options.keyName, expiry);

  if (loginResult.success) {
    console.log("✓ Login successful!");

    if (loginResult.credentials?.email) {
      console.log(`  Logged in as: ${loginResult.credentials.email}`);
    }

    if (loginResult.credentials?.apiKey) {
      console.log("  API key created and stored for future use.");
    }

    console.log("\nYou can now use Muggle AI Works tools.");
  } else {
    console.error("✗ Login failed");

    if (loginResult.error) {
      console.error(`  Error: ${loginResult.error}`);
    }

    if (loginResult.deviceCodeResponse) {
      console.log("\nIf browser didn't open, visit:");
      console.log(`  ${loginResult.deviceCodeResponse.verificationUriComplete}`);
      console.log(`  Code: ${loginResult.deviceCodeResponse.userCode}`);
    }

    process.exit(1);
  }
}

/**
 * Execute the logout command.
 */
export async function logoutCommand (): Promise<void> {
  console.log("\nLogging out...");

  performLogout();

  console.log("✓ Credentials cleared successfully.");
  logger.info("Logout completed");
}

/**
 * Execute the status command.
 */
export async function statusCommand (): Promise<void> {
  console.log("\nAuthentication Status");
  console.log("=====================\n");

  console.log(`Runtime target: ${getActiveRuntimeTarget()}`);
  console.log(`Backend: ${getConfig().e2e.promptServiceBaseUrl}\n`);

  const authService = getAuthService();
  const status = authService.getAuthStatus();
  const hasStoredApiKey = hasApiKey();

  if (status.authenticated) {
    console.log("✓ Authenticated");

    if (status.email) {
      console.log(`  Email: ${status.email}`);
    }

    if (status.userId) {
      console.log(`  User ID: ${status.userId}`);
    }

    if (status.expiresAt) {
      const expiresDate = new Date(status.expiresAt);
      console.log(`  Token expires: ${expiresDate.toLocaleString()}`);

      if (status.isExpired) {
        console.log("  (Token expired - will refresh automatically on next API call)");
      }
    }

    console.log(`  API Key: ${hasStoredApiKey ? "Yes" : "No"}`);
  } else {
    console.log("✗ Not authenticated");
    console.log("\nRun 'muggle login' to authenticate.");
  }
}

