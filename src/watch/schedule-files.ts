import { WATCH_CRON_MARKER, WATCH_LAUNCHD_LABEL, WATCH_SYSTEMD_UNIT_NAME } from "./constants.js";
import type { PosixTickJob } from "./types.js";

function xmlEscape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** One POSIX shell word: single-quoted, with each embedded quote closed, escaped and reopened. */
export function shellQuote(word: string): string {
  return `'${word.replace(/'/g, "'\\''")}'`;
}

// systemd splits ExecStart on spaces outside double quotes and expands `%`
// specifiers anywhere, so each argument is quoted and its `%` doubled.
function systemdQuote(word: string): string {
  return `"${word.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%")}"`;
}

function launcherArgs(job: PosixTickJob): string[] {
  return ["/bin/sh", job.launcherPath, job.nodePath, job.muggleEntry];
}

/**
 * The per-user launchd agent. launchd never starts a job while its previous run
 * is still going, which is the overlap guard the Windows task sets explicitly.
 */
export function renderLaunchdPlist(job: PosixTickJob): string {
  const programArguments = launcherArgs(job).map((arg) => `    <string>${xmlEscape(arg)}</string>`).join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    `  <string>${WATCH_LAUNCHD_LABEL}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    programArguments,
    "  </array>",
    "  <key>StartInterval</key>",
    `  <integer>${job.intervalSeconds}</integer>`,
    "  <key>RunAtLoad</key>",
    "  <false/>",
    "  <key>ProcessType</key>",
    "  <string>Background</string>",
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

/** The oneshot systemd user service one tick runs as; a oneshot never overlaps itself. */
export function renderSystemdService(job: PosixTickJob): string {
  return [
    "[Unit]",
    "Description=Muggle watch: tracks agent sessions, processes and PR watchers (@muggleai/works)",
    "",
    "[Service]",
    "Type=oneshot",
    `ExecStart=${launcherArgs(job).map(systemdQuote).join(" ")}`,
    "TimeoutStartSec=600",
    "",
  ].join("\n");
}

/**
 * The timer that fires the service. Its first run counts from when the timer
 * starts — enabling it, or the user's login — not from boot, so enabling it on
 * a long-running machine does not fire a tick at once on top of the installer's own.
 */
export function renderSystemdTimer(job: PosixTickJob): string {
  const minutes = Math.max(1, Math.round(job.intervalSeconds / 60));
  return [
    "[Unit]",
    `Description=Run the Muggle watch every ${minutes} min`,
    "",
    "[Timer]",
    `OnActiveSec=${minutes}min`,
    `OnUnitActiveSec=${minutes}min`,
    `Unit=${WATCH_SYSTEMD_UNIT_NAME}.service`,
    "",
    "[Install]",
    "WantedBy=timers.target",
    "",
  ].join("\n");
}

/** The crontab line, marked so a re-install finds and replaces it. Cron reads `%` as a newline, so it is escaped. */
export function renderCronLine(job: PosixTickJob): string {
  const minutes = Math.max(1, Math.round(job.intervalSeconds / 60));
  const command = launcherArgs(job).map(shellQuote).join(" ").replace(/%/g, "\\%");
  return `*/${minutes} * * * * ${command} ${WATCH_CRON_MARKER}`;
}

/** The environment file the launcher sources: the installing shell's PATH. */
export function renderWatchEnvFile(pathValue: string): string {
  return [
    "# Written by `muggle watch install`: the PATH of the shell that installed the",
    "# watch, restored because schedulers start jobs with a minimal one.",
    `export PATH=${shellQuote(pathValue)}`,
    "",
  ].join("\n");
}
