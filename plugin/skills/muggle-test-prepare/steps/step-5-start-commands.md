# Step 5: Determine Start Commands

For each required service not already running, figure out how to start it. Read **only** the indicator file that exists.

| Indicator | Stack | Default command | What to check |
|:----------|:------|:----------------|:--------------|
| `package.json` | Node.js | `npm run dev` | Read `scripts`: prefer `dev` > `start` > `serve` |
| `Makefile` | Various | `make dev` | Existence; propose `make dev` or `make run` |
| `Cargo.toml` | Rust | `cargo run` | Existence |
| `go.mod` | Go | `go run .` | Existence |
| `pyproject.toml` | Python | Check for framework | Read `[project.scripts]` or `[tool.poetry.scripts]` if present |
| `requirements.txt` | Python | `python app.py` | Existence |
| `docker-compose.yml` | Docker | `docker compose up` | Existence |

If no indicator found, ask the user for the start command.

Present all commands in a single summary:

```
Service              Directory                          Command
────────────────────────────────────────────────────────────────
backend-api          ~/Github/backend-api               npm run dev
auth-service         ~/Github/auth-service              go run .
frontend             ~/Github/frontend                  npm run dev
────────────────────────────────────────────────────────────────
```

- Option 1: "Looks good, start them"
- Option 2: "I need to edit some commands"
