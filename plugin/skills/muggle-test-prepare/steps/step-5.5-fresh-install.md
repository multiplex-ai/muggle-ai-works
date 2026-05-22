# Step 5.5: Fresh Install (clean-start default)

Detect stack by indicator file, decide if install is missing/stale, run automatically (notify, don't ask). Only opt-out is aborting the skill.

| Indicator | Stack | Stale check | Install command |
|:----------|:------|:------------|:----------------|
| `package.json` | Node | `node_modules/` missing OR `package-lock.json` newer than `node_modules/.package-lock.json` | `npm install --prefer-offline --no-audit --no-fund` |
| `pyproject.toml` w/ `[tool.poetry]` | Poetry | `poetry.lock` newer than `.venv/pyvenv.cfg` (or `.venv/` missing) | `poetry install --no-interaction` |
| `pyproject.toml` (PEP 621) + `uv.lock` | uv | `uv.lock` newer than `.venv/pyvenv.cfg` | `uv sync` |
| `requirements.txt` | pip | `requirements.txt` newer than `.venv/pyvenv.cfg` (or `.venv/` missing) | `pip install -r requirements.txt` |
| `Gemfile` | Bundler | `Gemfile.lock` newer than `vendor/bundle/` mtime | `bundle install` |
| `composer.json` | Composer | `composer.lock` newer than `vendor/autoload.php` | `composer install --no-interaction` |
| `pom.xml` | Maven | always (heavy — opt-in via `AskUserQuestion`) | `mvn -DskipTests install` |
| `build.gradle*` | Gradle | always (heavy — opt-in via `AskUserQuestion`) | `gradle build -x test` |
| `go.mod` | Go | skip — `go run`/`go build` handle deps |  |
| `Cargo.toml` | Rust | skip — `cargo run`/`cargo build` handle deps |  |

Notify one-liner: `Installing <service-name> (<stack>: <missing|stale>)…`.

**Never symlink dep dirs** (`node_modules/`, `.venv/`, `vendor/bundle/`) from a sibling worktree — webpack rewrites paths via `resolve.symlinks: true` and Python/Ruby tooling has analogous issues. Run a real per-worktree install.
