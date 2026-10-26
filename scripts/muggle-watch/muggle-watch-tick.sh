#!/bin/sh
# Launcher for `muggle watch tick` on macOS and Linux, run by the launchd agent,
# the systemd user timer, or the crontab line that `muggle watch install` sets up.
#
# Arguments: <node> <muggle.js> [extra tick flags...]
#
# Schedulers start jobs with a minimal PATH, so the PATH of the shell that ran
# the install is restored from watch-env.sh beside this script; without it the
# tick cannot find claude or gh. Output is appended to tick.log in the watch dir,
# capped at 1 MB by starting over, since the snapshot and events ledger are the
# record and the log only needs the recent failures.
#
# Keep this file ASCII with LF line endings: sh reads it byte for byte.

[ "$#" -ge 2 ] || exit 2
node_path=$1
muggle_entry=$2
shift 2

bin_dir=$(cd "$(dirname "$0")" && pwd)
watch_dir=$(dirname "$bin_dir")
log_path="$watch_dir/tick.log"
log_cap_bytes=1048576

if [ -f "$bin_dir/watch-env.sh" ]; then
    . "$bin_dir/watch-env.sh"
fi

if [ -f "$log_path" ] && [ "$(wc -c < "$log_path")" -gt "$log_cap_bytes" ]; then
    rm -f "$log_path"
fi

exec "$node_path" "$muggle_entry" watch tick "$@" >> "$log_path" 2>&1
