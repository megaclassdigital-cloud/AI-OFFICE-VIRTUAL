// notify.mjs — best-effort Windows balloon notification. NEVER throws, never blocks, never retries; failure is silent
// (the same message is always also in the log, the issue comment, and the Office View banner).
import { spawn } from 'node:child_process';

/** Pure: builds the PowerShell script. Single quotes are doubled and text is length-capped so input cannot break out of the string. */
export function buildToastScript(title, message) {
  const esc = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/'/g, "''").slice(0, 180);
  return [
    'Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing;',
    '$n = New-Object System.Windows.Forms.NotifyIcon;',
    '$n.Icon = [System.Drawing.SystemIcons]::Warning; $n.Visible = $true;',
    `$n.ShowBalloonTip(10000, '${esc(title)}', '${esc(message)}', 'Warning');`,
    'Start-Sleep -Seconds 11; $n.Dispose()',
  ].join(' ');
}

export function notifyOwner(title, message) {
  if (process.env.AAO_NOTIFY_DISABLED === '1' || process.platform !== 'win32') return false;
  try {
    const c = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', buildToastScript(title, message)], { detached: true, stdio: 'ignore', windowsHide: true });
    c.on('error', () => { /* abaikan */ });
    c.unref();
    return true;
  } catch { return false; }
}
