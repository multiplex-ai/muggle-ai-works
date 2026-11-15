/** Workflow type Studio routes to use-case discovery in explore mode. */
export const WEBSITE_SCAN_WORKFLOW_TYPE = "Website Scan Workflow";

/** Exploration goal the cloud website scan hands Studio; kept word-for-word so a local scan explores the same way. */
export const WEBSITE_SCAN_GOAL =
  "If login is possible, explore the post-login content to discover business-critical user stories. Look for navigation bar and menus to explore every pages of the website, until I tell you to stop.";

/** Precondition the cloud website scan hands Studio. */
export const WEBSITE_SCAN_PRECONDITION =
  "Try to 'register an new account' or 'log in' with managed profile or user-provided credentials; Must clear all dialogs, popups, tutorial, and notifications that block the main content first.";

/** Expected result the cloud website scan hands Studio. */
export const WEBSITE_SCAN_EXPECTED_RESULT = "Logged in successfully and explored the website until I tell you to stop.";
