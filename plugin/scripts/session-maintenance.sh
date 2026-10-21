#!/usr/bin/env bash

set -uo pipefail

# The slow session-start upkeep, launched detached by ensure-electron-app.sh at most
# once a day so no hook waits on it: state GC and the Electron runner install daily,
# and the npm version lookup every three days. The due stamp and the install's marker
# are claimed before the work starts, so sessions opening together run it once rather
# than once each. The hook payload arrives on stdin and is handed on to gc-state.sh.

# Epoch mtime of a file, or 0 if unreadable. GNU coreutils (Linux/WSL/Git Bash)
# need `stat -c %Y`; BSD/macOS need `stat -f %m`. The wrong form doesn't fail
# cleanly — GNU `stat -f` prints filesystem info to stdout and exits non-zero —
# so each form is tried alone and accepted only when all-digits, keeping stray
# text like `File:` out of the caller's arithmetic.
file_mtime() {
    local f="$1" m
    m=$(stat -c %Y "$f" 2>/dev/null) || m=""
    case "$m" in ''|*[!0-9]*) ;; *) printf '%s\n' "$m"; return 0 ;; esac
    m=$(stat -f %m "$f" 2>/dev/null) || m=""
    case "$m" in ''|*[!0-9]*) ;; *) printf '%s\n' "$m"; return 0 ;; esac
    printf '0\n'
}

# Sourcing with MUGGLE_SESSION_MAINTENANCE_LIB_ONLY=1 exposes the helper above
# without running the upkeep — used by the unit test.
if [ -n "${MUGGLE_SESSION_MAINTENANCE_LIB_ONLY:-}" ]; then
    return 0 2>/dev/null || exit 0
fi

maintenance_dir="${BASH_SOURCE[0]%/*}"
[ "$maintenance_dir" = "${BASH_SOURCE[0]}" ] && maintenance_dir=.
cache_dir="${HOME}/.cache/muggle"
electron_marker="${cache_dir}/electron-app-checked"
electron_ttl=$((24 * 60 * 60))
version_cache="${cache_dir}/version-check"
version_ttl=$((3 * 24 * 60 * 60))
upgrade_available="${cache_dir}/upgrade-available"

maintenance_stamp="${cache_dir}/session-maintenance-due"
# Matches the shortest TTL below, so the stamp never holds back work that is due.
maintenance_interval=$((24 * 60 * 60))

mkdir -p "$cache_dir" 2>/dev/null || true
now=$(date +%s)
printf '%s\n' "$((now + maintenance_interval))" > "$maintenance_stamp" 2>/dev/null || true

# Lets the other session-start hooks answer first: on Windows a burst of process
# starts here would slow theirs.
sleep 2

bash "${maintenance_dir}/gc-state.sh" || true

is_due() {
    local marker="$1" ttl="$2"
    [ ! -f "$marker" ] && return 0
    [ $((now - $(file_mtime "$marker"))) -ge "$ttl" ]
}

# A hung `muggle setup` (e.g. one blocked by host security policy on Windows)
# must not leak a ~100 MB orphan per session start, so the attempt is capped.
if is_due "$electron_marker" "$electron_ttl"; then
    touch "$electron_marker" 2>/dev/null || true
    setup_timeout=""
    command -v timeout >/dev/null 2>&1 && setup_timeout="timeout -k 5 60"
    if command -v muggle >/dev/null 2>&1; then
        ${setup_timeout} muggle setup >/dev/null 2>&1 || true
    else
        ${setup_timeout} npx -y @muggleai/works setup >/dev/null 2>&1 || true
    fi
fi

# The cache holds "installed|latest". It is not claimed up front: a failed lookup
# leaves it due, so the next start retries rather than waiting out the TTL.
if is_due "$version_cache" "$version_ttl"; then
    installed=$(muggle --version 2>/dev/null | tr -d '[:space:]' || true)
    latest=$(npm view @muggleai/works version 2>/dev/null | tr -d '[:space:]' || true)
    if [ -n "$installed" ] && [ -n "$latest" ]; then
        printf '%s|%s' "$installed" "$latest" > "$version_cache" 2>/dev/null || true
    fi
fi

# ensure-electron-app.sh announces an upgrade only while this file exists, so the
# version comparison (sort -V) never runs on the hook's own path.
cached_versions=$(cat "$version_cache" 2>/dev/null || true)
installed="${cached_versions%%|*}"
latest="${cached_versions##*|}"
newest=""
if [ -n "$installed" ] && [ -n "$latest" ] && [ "$installed" != "$latest" ]; then
    newest=$(printf '%s\n%s\n' "$installed" "$latest" | sort -V | tail -n1)
fi
if [ -n "$newest" ] && [ "$newest" = "$latest" ]; then
    printf '%s|%s' "$installed" "$latest" > "$upgrade_available" 2>/dev/null || true
else
    rm -f "$upgrade_available" 2>/dev/null || true
fi

exit 0
