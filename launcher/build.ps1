# build.ps1 — membangun AIOffice.exe (aplikasi tray) dari launcher\AIOffice.cs memakai compiler C# bawaan Windows (tanpa dependensi).
# Pemakaian: powershell -ExecutionPolicy Bypass -File launcher\build.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "csc.exe tidak ditemukan di $csc" }
$out = Join-Path $root 'AIOffice.exe'
& $csc /nologo /target:winexe /optimize+ /out:$out /r:System.Windows.Forms.dll /r:System.Drawing.dll (Join-Path $PSScriptRoot 'AIOffice.cs')
if ($LASTEXITCODE -ne 0) { throw "Build gagal (kode $LASTEXITCODE)" }
$f = Get-Item $out
"Berhasil: $($f.FullName) ($([math]::Round($f.Length / 1KB, 1)) KB)"
