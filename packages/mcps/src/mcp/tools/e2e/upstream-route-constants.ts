/** Prompt-service route prefix of the Muggle Test API. */
export const MUGGLE_TEST_PREFIX = "/v1/protected/muggle-test";

/** Prompt-service route of the caller's taste profile (GET / PUT / DELETE). */
export const TASTE_PROFILE_PATH = `${MUGGLE_TEST_PREFIX}/taste-profile`;

/** Prompt-service route listing the channels of a project's connected Slack workspace (GET, `?projectId`). */
export const SLACK_CHANNELS_PATH = `${MUGGLE_TEST_PREFIX}/slack/channels`;

/** Prompt-service route saving the Slack channel a project's reports post to (POST). */
export const SLACK_CHANNEL_PATH = `${MUGGLE_TEST_PREFIX}/slack/channel`;

/** Prompt-service route disconnecting Slack from a project (DELETE, `?projectId`). */
export const SLACK_CONNECTION_PATH = `${MUGGLE_TEST_PREFIX}/slack/connection`;

/** Prompt-service route of the report generation workflows (GET lists them, `?projectId`). */
export const REPORT_GENERATION_WORKFLOWS_PATH = `${MUGGLE_TEST_PREFIX}/workflow/report-generation`;

/** Prompt-service route prefix of the iOS pool relay. */
export const IOS_POOL_PREFIX = "/v1/protected/ios-pool";
