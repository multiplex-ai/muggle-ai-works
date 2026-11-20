#!/usr/bin/env bash

set -uo pipefail

# The slow upkeep, launched detached at most once an hour so no hook waits on it: the
# npm version lookup behind the upgrade notice, state GC and the Electron runner
# install. ensure-electron-app.sh launches it at session start and
# guardrail-skill-stages.sh on a skill call, so a session open for days still gets it.
# The due stamp and the install's marker are claimed before the work starts, so
# sessions opening together run it once rather than once each. The hook payload
# arrives on stdin and is handed on to gc-state.sh.

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

# The dist-tag of the release lane a version sits on: a `-staging.` build is staging,
# anything else stable. Semver orders 5.15.0-staging.106 below 5.15.0, so a staging build
# measured against `latest` reads as out of date and a newer staging build goes unseen.
release_lane_tag() {
    case "$1" in
        *-staging.*) printf 'staging\n' ;;
        *) printf 'latest\n' ;;
    esac
}

# Whether $1 has the shape of a package version. A registry error or a proxy's sign-in
# page read as a version would otherwise be announced as an upgrade.
is_package_version() {
    case "$1" in
        '' | *[!0-9A-Za-z.+-]*) return 1 ;;
        [0-9]*.[0-9]*.[0-9]*) return 0 ;;
        *) return 1 ;;
    esac
}

# Sets VERSION_ORDER to 1, 0 or -1 as the dot-separated identifiers in $1 sort after,
# with or before those in $2, the way semver orders them: numbers by value, so
# staging.100 follows staging.99, and a longer run of identifiers after its own prefix.
compare_dotted_identifiers() {
    local left_fields right_fields index left right
    IFS=. read -r -a left_fields <<<"$1"
    IFS=. read -r -a right_fields <<<"$2"
    VERSION_ORDER=0
    for ((index = 0; index < ${#left_fields[@]} || index < ${#right_fields[@]}; index++)); do
        left="${left_fields[index]-}"
        right="${right_fields[index]-}"
        [ "$left" = "$right" ] && continue
        if [ -z "$left" ]; then
            VERSION_ORDER=-1
        elif [ -z "$right" ]; then
            VERSION_ORDER=1
        else
            case "$left$right" in
                *[!0-9]*) [[ $left < $right ]] && VERSION_ORDER=-1 || VERSION_ORDER=1 ;;
                *) ((10#$left < 10#$right)) && VERSION_ORDER=-1 || VERSION_ORDER=1 ;;
            esac
        fi
        return 0
    done
}

# Whether version $1 is newer than version $2. Done in the shell rather than with
# `sort -V`, which not every platform's sort has and which puts a release before its
# own prerelease.
version_is_newer() {
    local candidate_core="${1%%[-+]*}" installed_core="${2%%[-+]*}"
    compare_dotted_identifiers "$candidate_core" "$installed_core"
    if [ "$VERSION_ORDER" -ne 0 ]; then
        [ "$VERSION_ORDER" -gt 0 ]
        return
    fi
    local candidate_prerelease="${1#"$candidate_core"}" installed_prerelease="${2#"$installed_core"}"
    candidate_prerelease="${candidate_prerelease%%+*}"
    installed_prerelease="${installed_prerelease%%+*}"
    if [ -z "$candidate_prerelease" ]; then
        [ -n "$installed_prerelease" ]
        return
    fi
    [ -n "$installed_prerelease" ] || return 1
    compare_dotted_identifiers "${candidate_prerelease#-}" "${installed_prerelease#-}"
    [ "$VERSION_ORDER" -gt 0 ]
}

# Sourcing with MUGGLE_SESSION_MAINTENANCE_LIB_ONLY=1 exposes the helpers above
# without running the upkeep — used by the unit test.
if [ -n "${MUGGLE_SESSION_MAINTENANCE_LIB_ONLY:-}" ]; then
    return 0 2>/dev/null || exit 0
fi

maintenance_dir="${BASH_SOURCE[0]%/*}"
[ "$maintenance_dir" = "${BASH_SOURCE[0]}" ] && maintenance_dir=.
. "${maintenance_dir}/guardrail-lib.sh"
cache_dir="${HOME}/.cache/muggle"
electron_marker="${cache_dir}/electron-app-checked"
electron_ttl=$((24 * 60 * 60))
upgrade_available="${cache_dir}/upgrade-available"

maintenance_stamp="${cache_dir}/session-maintenance-due"
# The version lookup's cadence: a lane can publish several builds a day, and a failed
# lookup is retried at the next run. The daily steps below keep their own markers.
maintenance_interval=$((60 * 60))

mkdir -p "$cache_dir" 2>/dev/null || true
now=$(date +%s)
printf '%s\n' "$((now + maintenance_interval))" > "$maintenance_stamp" 2>/dev/null || true

# Lets the other session-start hooks answer first: on Windows a burst of process
# starts here would slow theirs.
sleep 2

# Leaves "installed|latest" in the upgrade file only while the head of the installed
# build's own lane is newer; the hooks announce an upgrade only while that file
# exists, so no lookup or comparison runs on a hook's own path. It only reads the
# registry and never installs. A lookup that fails, times out or returns something
# that is no version changes nothing, so an upgrade already recorded stays announced.
refresh_upgrade_notice() {
    if guardrail_updates_disabled; then
        rm -f "$upgrade_available" 2>/dev/null || true
        return 0
    fi
    local lookup_timeout=""
    command -v timeout >/dev/null 2>&1 && lookup_timeout="timeout -k 5 30"
    local installed latest
    installed=$(${lookup_timeout} muggle --version 2>/dev/null | tr -d '[:space:]' || true)
    is_package_version "$installed" || return 0
    latest=$(${lookup_timeout} npm view @muggleai/works "dist-tags.$(release_lane_tag "$installed")" 2>/dev/null | tr -d '[:space:]' || true)
    is_package_version "$latest" || return 0
    if version_is_newer "$latest" "$installed"; then
        printf '%s|%s' "$installed" "$latest" > "$upgrade_available" 2>/dev/null || true
    else
        rm -f "$upgrade_available" 2>/dev/null || true
    fi
}

# In a process of its own, started before the steps below: a state sweep or an
# Electron install that stalls, fails or is killed must not take the update check
# with it.
refresh_upgrade_notice &

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

wait

exit 0
