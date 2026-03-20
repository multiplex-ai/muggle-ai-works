/**
 * Login/logout/status commands for authentication.
 */

import {
  getAuthService,
  getLogger,
  hasApiKey,
  performLogin,
  performLogout,
} from "@muggleai/mcp";

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
export async function loginCommand(options: ILoginOptions): Promise<void> {
  console.log("\nMuggle AI Login");
  console.log("===============\n");

  const expiry = (options.keyExpiry || "90d") as "30d" | "90d" | "1y" | "never";

  console.log("Starting device code authentication...");
  console.log("A browser window will open for you to complete login.\n");

  const result = await performLogin(options.keyName, expiry);

  if (result.success) {
    console.log("✓ Login successful!");

    if (result.credentials?.email) {
      console.log(`  Logged in as: ${result.credentials.email}`);
    }

    if (result.credentials?.apiKey) {
      console.log("  API key created and stored for future use.");
    }

    console.log("\nYou can now use Muggle AI Works tools.");
  } else {
    console.error("✗ Login failed");

    if (result.error) {
      console.error(`  Error: ${result.error}`);
    }

    if (result.deviceCodeResponse) {
      console.log("\nIf browser didn't open, visit:");
      console.log(`  ${result.deviceCodeResponse.verificationUriComplete}`);
      console.log(`  Code: ${result.deviceCodeResponse.userCode}`);
    }

    process.exit(1);
  }
}

/**
 * Execute the logout command.
 */
export async function logoutCommand(): Promise<void> {
  console.log("\nLogging out...");

  performLogout();

  console.log("✓ Credentials cleared successfully.");
  logger.info("Logout completed");
}

/**
 * Execute the status command.
 */
export async function statusCommand(): Promise<void> {
  console.log("\nAuthentication Status");
  console.log("=====================\n");

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

