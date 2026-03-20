# Local Testing Skills

Skills for use with the **Muggle AI Local MCP server** (`@muggle-ai/local-mcp`).

## When to Use

Use these skills when testing applications on:
- `localhost`
- `127.0.0.1`
- Local network IPs (`192.168.x.x`)
- Docker containers on local ports

## Available Skills

| Skill | Description |
| :---- | :---------- |
| [test-feature-local](./test-feature-local/) | Test features locally with cloud-first entity management |
| [publish-test-to-cloud](./publish-test-to-cloud/) | Publish locally generated test scripts to cloud |

## Prerequisites

- Muggle AI Local MCP server installed and running
- Your web application running locally

## Installation

```bash
# Copy to personal Cursor skills
cp -r test-feature-local ~/.cursor/skills/
cp -r publish-test-to-cloud ~/.cursor/skills/

# Or copy to project skills
cp -r test-feature-local .cursor/skills/
cp -r publish-test-to-cloud .cursor/skills/
```

## Do NOT Use For

These skills will **not work** for:
- Public URLs (staging, production)
- Preview deployments
- Any URL not accessible from your local machine

For public URLs, use the [Remote Testing Skills](../remote/).
