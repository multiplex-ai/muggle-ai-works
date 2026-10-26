# `autoInstallWatchService`

Controls whether Muggle runs Muggle Watch, a per-user scheduled job that every two minutes resumes the owner session of a dead PR watcher, moves idle sessions onto the newest install, and alerts on red CI and stale branches. It runs under Task Scheduler on Windows, launchd on macOS, and a systemd user timer on Linux (cron where there is none). Acted on without a prompt by every global install or upgrade (postinstall) and by `muggle init`; the picker fires only from `/muggle-upgrade`. Where the job already exists only `never` counts: any other value lets an upgrade refresh it in place.

**Picker 1** — header `Muggle Watch`, question `"Run Muggle Watch in the background? It brings back dead PR watchers and moves idle sessions onto the newest install."`
- `Install it` — `Run muggle watch install now, and refresh it on every upgrade.` → `always`
- `Ask me next time` — `Leave it off and ask after the next upgrade.` → `ask`
- `Never` — `Don't install it; muggle watch install adds it later.` → `never`

**Silent action**
- `always` → `Muggle Watch is installed and refreshed with this upgrade`
- `ask` → `Asking whether to run Muggle Watch`
- `never` → `Leaving Muggle Watch off`
