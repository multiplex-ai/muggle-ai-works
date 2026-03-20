# Muggle AI Skills

Agent Skills for AI-assisted testing workflows with Muggle AI. These skills work with [Cursor IDE](https://cursor.com) and other AI coding assistants that support skill-based workflows.

## Local vs Remote Skills

Muggle AI provides two testing modes with different MCP servers. **Use the right skills for your setup:**

| Mode | MCP Server | Target URLs | Skills Folder |
| :--- | :--------- | :---------- | :------------ |
| **Local Testing** | `@muggle-ai/local-mcp` | `localhost`, local network | `skills/local/` |
| **Remote Testing** | MCP Gateway (cloud) | Public URLs (staging, production) | `skills/remote/` |

```
muggle-ai-mcp/
└── skills/
    ├── local/                    # For local MCP server
    │   ├── test-feature-local/   # Test localhost apps
    │   └── publish-to-cloud/     # Publish local projects to cloud
    └── remote/                   # For remote MCP gateway
        └── (coming soon)
```

## Local Skills

Use these with the **Local MCP server** (`@muggle-ai/local-mcp`) for testing `localhost` applications.

### [test-feature-local](./local/test-feature-local/)

Test features on your local development server with automatic change detection.

**Triggers:** "test my changes", "test the login feature", "run tests"

**What it does:**
1. Analyzes `git diff` to identify impacted features
2. Finds or creates test projects, use cases, test cases
3. Generates new test scripts or replays existing ones
4. Reports results with pass/fail summary

### [publish-to-cloud](./local/publish-to-cloud/)

Publish local test projects to Muggle AI cloud for team collaboration.

**Triggers:** "publish to cloud", "sync my project", "upload tests"

**What it does:**
1. Authenticates with Muggle AI
2. Prompts for production URL (if localhost)
3. Syncs project, use cases, test cases to cloud
4. Returns cloud dashboard URLs

## Remote Skills

Use these with the **Remote MCP Gateway** for testing publicly accessible URLs (staging, production).

*(Coming soon)*

## Installation

### Get the Skills

```bash
git clone https://github.com/muggle-ai/muggle-ai-mcp.git
```

### For Cursor IDE

**Personal Installation** (available in all projects):

```bash
# Install local skills
cp -r muggle-ai-mcp/skills/local/* ~/.cursor/skills/

# Install remote skills (when available)
cp -r muggle-ai-mcp/skills/remote/* ~/.cursor/skills/
```

**Project Installation** (shared with team):

```bash
mkdir -p .cursor/skills
cp -r muggle-ai-mcp/skills/local/* .cursor/skills/
```

### For Other AI Assistants

Skills are markdown files with structured instructions. Adapt the `SKILL.md` files to your assistant's format.

## Prerequisites

| Skill Type | Requirements |
| :--------- | :----------- |
| **Local Skills** | Local MCP server running, app on localhost |
| **Remote Skills** | MCP Gateway configured, public URL |

## Authentication & Token Handling

All skills require authentication with Muggle AI. Tokens can expire, requiring re-authentication.

### Checking Token Status

Use `muggle-remote-auth-status` (or `muggle_auth_status`) to check:
- Whether authenticated
- Token expiration time (`expiresAt` field)

### Handling Expired Tokens

When tokens are expired:

1. **Re-authenticate**: Call `muggle-remote-auth-login` to get fresh tokens
2. **If login fails with "unauthorized_client"**: Environment mismatch detected
   - Set `MUGGLE_MCP_PROMPT_SERVICE_TARGET` to `production` or `dev` in MCP config
   - Restart Cursor after config change

### Manual Recovery

If authentication keeps failing:

```bash
# Clear credentials and re-login
muggle-mcp logout
muggle-mcp login

# Or delete credential files directly
rm ~/.muggle-ai/auth.json
rm ~/.muggle-ai/credentials.json
muggle-mcp login
```

## Usage Examples

### Local Testing

```
"Test my changes"
"Test the login feature on localhost:3000"
"Run the authentication tests"
"Re-run failed tests"
```

### Publishing

```
"Publish my tests to the cloud"
"Sync my project to Muggle AI"
```

### Remote Testing (with remote skills)

```
"Test the staging environment"
"Run regression tests on production"
```

## Skill Details

### test-feature-local

**Workflow:**
```
Analyze Git Changes → Identify Impacted Features
        ↓
List/Create Project → List/Create Use Cases
        ↓
List/Create Test Cases → Check for Test Scripts
        ↓
Generate (if none) or Replay (if exists)
        ↓
Report Results Summary
```

**Key Features:**
- Automatic change detection via `git diff`
- Batch execution of multiple tests
- Impact analysis to suggest relevant tests
- Summary reports with pass/fail status

### publish-to-cloud

**Workflow:**
```
Check Authentication → Login if Needed
        ↓
Select Project → Update Production URL
        ↓
Sync to Cloud → Report Cloud URLs
```

**Key Features:**
- Device code authentication flow
- Automatic URL migration (localhost → production)
- Selective publishing (all, specific use case, new only)
- Idempotent updates to existing cloud entities

## Related Documentation

- [Local Testing Overview](https://docs.muggle-ai.com/local-testing/overview)
- [Local Testing Tools Reference](https://docs.muggle-ai.com/local-testing/tools-reference)
- [Remote Testing (MCP Gateway)](https://docs.muggle-ai.com/mcp/overview)

## Contributing

To contribute new skills:

1. Fork this repository
2. Add skills to appropriate folder (`skills/local/` or `skills/remote/`)
3. Follow the SKILL.md structure
4. Submit a pull request

## License

MIT License
