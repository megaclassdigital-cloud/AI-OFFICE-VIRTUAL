# start-paperclip.ps1
# Menjalankan server Paperclip untuk AI Agent Office.
#
# Paperclip tidak mendukung Windows service (doctor: "Service management is not
# supported on win32"), jadi server harus dijalankan sebagai proses biasa.
# Script ini menjalankannya terlepas (detached) supaya tidak ikut mati ketika
# shell pemanggil ditutup.
#
# Pemakaian:
#   .\scripts\start-paperclip.ps1            # start detached, tulis log ke workspace\
#   .\scripts\start-paperclip.ps1 -Status    # cek apakah server hidup
#   .\scripts\start-paperclip.ps1 -Stop      # hentikan server
#   .\scripts\start-paperclip.ps1 -Foreground # jalankan di shell ini (Ctrl+C untuk stop)

[CmdletBinding()]
param(
    [switch]$Status,
    [switch]$Stop,
    [switch]$Foreground
)

$ErrorActionPreference = 'Stop'

# Versi dipin. Lihat docs/versions.md (aturan 9: upgrade = tugas terpisah).
$PaperclipVersion = '2026.1001.0'
$HealthUrl        = 'http://127.0.0.1:3177/api/health'
$RepoRoot         = Split-Path -Parent $PSScriptRoot
$LogDir           = Join-Path $RepoRoot 'workspace'
$OutLog           = Join-Path $LogDir 'paperclip-server.out.log'
$ErrLog           = Join-Path $LogDir 'paperclip-server.err.log'

function Get-NodePath {
    # PATH mesin/pengguna dimuat ulang supaya script tetap jalan di shell yang
    # dibuka sebelum Node dipasang.
    $machine = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user    = [System.Environment]::GetEnvironmentVariable('Path', 'User')
    return "$machine;$user"
}

function Test-PaperclipHealth {
    try {
        $h = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 5
        return $h
    } catch {
        return $null
    }
}

function Get-PaperclipProcess {
    # Proses node yang menjalankan paperclipai, bukan aplikasi Node lain milik owner
    # (ERP-KIOS, JARVIS). Dicocokkan dari command line.
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -match 'paperclipai' }
}

if ($Status) {
    $h = Test-PaperclipHealth
    if ($h) {
        Write-Host "Paperclip HIDUP  status=$($h.status) version=$($h.version) bootstrap=$($h.bootstrapStatus)"
        Write-Host "URL: http://127.0.0.1:3177"
        exit 0
    }
    Write-Host 'Paperclip MATI (tidak ada respons di http://127.0.0.1:3177)'
    exit 1
}

if ($Stop) {
    $procs = Get-PaperclipProcess
    if (-not $procs) {
        Write-Host 'Tidak ada proses Paperclip yang berjalan.'
        exit 0
    }
    foreach ($p in $procs) {
        Write-Host "Menghentikan PID $($p.ProcessId)"
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Write-Host 'Paperclip dihentikan. Proses postgres ikut berhenti beberapa detik kemudian.'
    exit 0
}

# Sudah hidup? Jangan start dua kali.
$existing = Test-PaperclipHealth
if ($existing) {
    Write-Host "Paperclip sudah berjalan (status=$($existing.status)). Tidak melakukan apa-apa."
    Write-Host 'URL: http://127.0.0.1:3177'
    exit 0
}

if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

$env:Path = Get-NodePath

if ($Foreground) {
    Write-Host "Menjalankan Paperclip $PaperclipVersion di shell ini. Ctrl+C untuk berhenti."
    & npx --yes "paperclipai@$PaperclipVersion" run
    exit $LASTEXITCODE
}

Write-Host "Menjalankan Paperclip $PaperclipVersion secara detached..."
$inner = "`$env:Path = '$($env:Path -replace "'","''")'; npx --yes paperclipai@$PaperclipVersion run"

Start-Process -FilePath 'powershell.exe' `
    -ArgumentList '-NoProfile', '-NonInteractive', '-Command', $inner `
    -WindowStyle Hidden `
    -RedirectStandardOutput $OutLog `
    -RedirectStandardError $ErrLog | Out-Null

Write-Host "Log: $OutLog"
Write-Host 'Menunggu server siap (embedded Postgres butuh waktu di mesin ini)...'

$deadline = (Get-Date).AddMinutes(5)
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 5
    $h = Test-PaperclipHealth
    if ($h -and $h.status -eq 'ok') {
        Write-Host "SIAP. status=$($h.status) version=$($h.version)"
        Write-Host 'URL: http://127.0.0.1:3177'
        exit 0
    }
}

Write-Warning "Server belum menjawab 'ok' dalam 5 menit. Periksa $OutLog dan $ErrLog."
exit 1
