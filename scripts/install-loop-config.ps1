# install-loop-config.ps1 — memasang konfigurasi loop engineering ke .claude\ (dijalankan owner SEKALI).
# Sumber: setup\claude\  →  Tujuan: .claude\
# Aman diulang. File .claude\settings.json lama (jika ada) dicadangkan dulu.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Src  = Join-Path $Root "setup\claude"
$Dst  = Join-Path $Root ".claude"

New-Item -ItemType Directory -Force -Path (Join-Path $Dst "hooks"), (Join-Path $Dst "agents") | Out-Null

$settings = Join-Path $Dst "settings.json"
if (Test-Path $settings) {
  $backup = Join-Path $Dst ("settings.backup-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".json")
  Copy-Item $settings $backup
  Write-Host "Cadangan settings lama: $backup"
}

Copy-Item (Join-Path $Src "settings.json")            $settings -Force
Copy-Item (Join-Path $Src "hooks\loop-guard.js")      (Join-Path $Dst "hooks\loop-guard.js") -Force
Copy-Item (Join-Path $Src "hooks\session-start.js")   (Join-Path $Dst "hooks\session-start.js") -Force
Copy-Item (Join-Path $Src "agents\reviewer.md")       (Join-Path $Dst "agents\reviewer.md") -Force

Write-Host ""
Write-Host "Terpasang ke $Dst. Verifikasi:"
Push-Location $Root
node scripts/loop-status.js --check
$out = '{"session_id":"install-selftest"}' | node .claude/hooks/loop-guard.js
Write-Host "Selftest hook Stop: $out"
Remove-Item (Join-Path $Root "loop\.guard-state.json") -ErrorAction SilentlyContinue
node .claude/hooks/session-start.js
Pop-Location
