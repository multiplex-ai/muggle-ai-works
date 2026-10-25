import { WATCH_NOTIFICATION_MAX_LINES } from "./constants.js";
import { shortSessionId } from "./format.js";
import {
  ReloadAction,
  WatcherRecoveryOutcome,
  WatchFindingSeverity,
  type CommandRunner,
  type DesktopNotifier,
  type ReloadReport,
  type WatcherRecovery,
  type WatchFinding,
} from "./types.js";

/**
 * The lines of this tick's one notification, or an empty list when nothing in
 * it deserves interrupting the user: newly raised alerts, resumes attempted,
 * and terminal sessions that must reload by hand.
 */
export function composeTickNotification(
  raised: WatchFinding[],
  recoveries: WatcherRecovery[],
  reload: ReloadReport | undefined,
): string[] {
  const lines: string[] = [];
  for (const raisedFinding of raised) {
    if (raisedFinding.severity === WatchFindingSeverity.Alert) {
      lines.push(`${raisedFinding.subject}: ${raisedFinding.message}`);
    }
  }
  for (const recovery of recoveries) {
    const owner = shortSessionId(recovery.ownerSessionId);
    if (recovery.outcome === WatcherRecoveryOutcome.Resumed) {
      lines.push(`Resumed session ${owner} to re-arm ${recovery.slotSlugs.join(", ")}`);
    } else if (recovery.outcome === WatcherRecoveryOutcome.ResumeFailed) {
      lines.push(`Could not resume session ${owner} for ${recovery.slotSlugs.join(", ")}`);
    }
  }
  const manualReloads = (reload?.decisions ?? []).filter((decision) => decision.action === ReloadAction.NotifyManual);
  if (manualReloads.length > 0) {
    const sessionNames = manualReloads.map((decision) => decision.name ?? shortSessionId(decision.sessionId));
    lines.push(`Plugins changed — run /reload-plugins in: ${sessionNames.join(", ")}`);
  }
  if (lines.length <= WATCH_NOTIFICATION_MAX_LINES) return lines;
  return [...lines.slice(0, WATCH_NOTIFICATION_MAX_LINES), `+${lines.length - WATCH_NOTIFICATION_MAX_LINES} more — muggle watch status`];
}

function powershellLiteral(text: string): string {
  return `'${text.replace(/'/g, "''")}'`;
}

// The same WinRT toast memwatch raises, through Windows PowerShell, whose
// runtime still projects the WinRT types. Encoded so a finding's text can never
// break out of its quoting.
function buildWindowsToastScript(title: string, body: string): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
    "$toastXml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)",
    "$textNodes = $toastXml.GetElementsByTagName('text')",
    `$textNodes.Item(0).AppendChild($toastXml.CreateTextNode(${powershellLiteral(title)})) | Out-Null`,
    `$textNodes.Item(1).AppendChild($toastXml.CreateTextNode(${powershellLiteral(body)})) | Out-Null`,
    "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('MuggleWatch').Show([Windows.UI.Notifications.ToastNotification]::new($toastXml))",
  ].join("\n");
}

function appleScriptLiteral(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** A notifier for this platform: a toast on Windows, Notification Center on macOS, `notify-send` elsewhere. */
export function createDesktopNotifier(platform: NodeJS.Platform, runCommand: CommandRunner): DesktopNotifier {
  return (title, lines) => {
    if (lines.length === 0) return;
    const body = lines.join("\n");
    if (platform === "win32") {
      const encodedScript = Buffer.from(buildWindowsToastScript(title, body), "utf16le").toString("base64");
      runCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodedScript]);
    } else if (platform === "darwin") {
      runCommand("osascript", ["-e", `display notification ${appleScriptLiteral(body)} with title ${appleScriptLiteral(title)}`]);
    } else {
      runCommand("notify-send", [title, body]);
    }
  };
}
