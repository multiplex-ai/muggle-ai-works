# Remote Testing Skills

Skills for use with the **Muggle AI Remote MCP Gateway** (cloud-based testing).

## When to Use

Use these skills when testing applications on:
- Preview deployments (`pr-123.preview.example.com`)
- Staging environments (`staging.example.com`)
- Production (`www.example.com`)
- Any publicly accessible URL

## Available Skills

*(Coming soon)*

Planned skills:
- `test-deployment` — Test preview/staging deployments
- `regression-test` — Run regression tests on production
- `schedule-tests` — Set up scheduled test runs

## Prerequisites

- Muggle AI account with MCP Gateway access
- MCP Gateway configured in your AI assistant
- Target URL must be publicly accessible

## Do NOT Use For

These skills will **not work** for:
- `localhost` URLs
- Local network addresses
- Any URL not accessible from the internet

For local testing, use the [Local Testing Skills](../local/).
