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

function Repair-Plugins {
    # Saat boot, worker plugin dimuat bersamaan dengan Postgres. Impor dingin SDK memakan
    # ~8 detik di mesin ini, sedangkan Paperclip membatasi RPC "initialize" 15 detik, jadi
    # plugin sering berstatus `error` setelah restart padahal tidak ada yang rusak
    # (terbukti di L0.4/G0: `plugin enable` saat mesin tenang langsung `ready`).
    # Perbaikan memakai CLI resmi, bukan mengubah core.
    try {
        $plugins = Invoke-RestMethod -Uri 'http://127.0.0.1:3177/api/plugins' -TimeoutSec 20
    } catch {
        Write-Warning "Tidak bisa membaca daftar plugin: $($_.Exception.Message)"
        return
    }
    if ($plugins -isnot [System.Array] -and $plugins.PSObject.Properties.Name -contains 'plugins') { $plugins = $plugins.plugins }
    foreach ($pl in $plugins) {
        $key = if ($pl.key) { $pl.key } else { $pl.pluginKey }
        if ($pl.status -eq 'error') {
            Write-Host "Plugin '$key' berstatus error setelah boot. Mengaktifkan ulang (mesin sudah tenang)..."
            Push-Location $env:TEMP
            & npx --yes "paperclipai@$PaperclipVersion" plugin enable $key 2>&1 | ForEach-Object { Write-Host "  $_" }
            Pop-Location
        }
    }
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
    Write-Host "Paperclip sudah berjalan (status=$($existing.status)). Server tidak dinyalakan ulang."
    Repair-Plugins   # menyembuhkan plugin `error` tanpa restart server
    Write-Host 'URL: http://127.0.0.1:3177'
    exit 0
}

if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

$env:Path = Get-NodePath
# Gemini CLI ACP cold start can exceed Paperclip default of 15s on this machine.
$env:ACPX_GEMINI_ACP_STARTUP_TIMEOUT_MS = '120000'

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

# Boot dingin di mesin ini (2 core) terukur 6-8 menit; 5 menit terbukti kurang (L0.4).
$deadline = (Get-Date).AddMinutes(12)
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 5
    $h = Test-PaperclipHealth
    if ($h -and $h.status -eq 'ok') {
        Write-Host "SIAP. status=$($h.status) version=$($h.version)"
        Repair-Plugins
        Write-Host 'URL: http://127.0.0.1:3177'
        exit 0
    }
}

Write-Warning "Server belum menjawab 'ok' dalam 12 menit. Periksa $OutLog dan $ErrLog."
exit 1
