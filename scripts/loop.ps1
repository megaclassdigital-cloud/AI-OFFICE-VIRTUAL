# loop.ps1 — menjalankan loop tanpa pengawasan, satu sesi Claude Code baru per iterasi (konteks selalu segar).
# Pakai:  powershell -ExecutionPolicy Bypass -File scripts\loop.ps1 [-MaxIterations 20] [-PermissionMode acceptEdits]
# Berhenti otomatis saat loop.status bukan RUNNING (DONE / HARD_STOP / STALLED / PAUSED) atau batas iterasi tercapai.
param(
  [int]$MaxIterations = 20,
  [string]$PermissionMode = "acceptEdits",
  [int]$PauseSeconds = 10
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$LogDir = Join-Path $Root "loop\journal"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Get-LoopStatus {
  (Get-Content (Join-Path $Root "loop\backlog.json") -Raw | ConvertFrom-Json).loop.status
}

$Prompt = "Mode LOOP. Baca loop/LOOP.md dan CLAUDE.md, lalu lanjutkan loop dari task yang ditunjuk 'node scripts/loop-status.js --next'. Jangan bertanya ke owner."

for ($i = 1; $i -le $MaxIterations; $i++) {
  $status = Get-LoopStatus
  if ($status -ne "RUNNING") { Write-Host "Loop berhenti: status = $status"; break }
  $next = node scripts/loop-status.js --next
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $log = Join-Path $LogDir "run-$stamp.log"
  Write-Host "[$i/$MaxIterations] $stamp  task berikutnya: $next  log: $log"
  claude -p $Prompt --permission-mode $PermissionMode *>&1 | Tee-Object -FilePath $log
  node scripts/loop-status.js --write-status | Out-Null
  Start-Sleep -Seconds $PauseSeconds
}
node scripts/loop-status.js
