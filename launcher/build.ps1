# build.ps1 — membangun AIOffice.exe (aplikasi tray) dari launcher\AIOffice.cs memakai compiler C# bawaan Windows (tanpa dependensi).
# Pemakaian: powershell -ExecutionPolicy Bypass -File launcher\build.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "csc.exe tidak ditemukan di $csc" }

# Ikon aplikasi (.ico berisi PNG 256px) digambar dari kode supaya tidak ada berkas biner tambahan di repo.
Add-Type -AssemblyName System.Drawing
$ico = Join-Path $PSScriptRoot 'aioffice.ico'
$bmp = New-Object System.Drawing.Bitmap 256, 256
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'
$g.Clear([System.Drawing.Color]::Transparent)
$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush ([System.Drawing.Point]::new(0, 0)), ([System.Drawing.Point]::new(256, 256)), ([System.Drawing.Color]::FromArgb(37, 99, 235)), ([System.Drawing.Color]::FromArgb(124, 58, 237))
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 56; $path.AddArc(8, 8, $r, $r, 180, 90); $path.AddArc(256 - 8 - $r, 8, $r, $r, 270, 90); $path.AddArc(256 - 8 - $r, 256 - 8 - $r, $r, $r, 0, 90); $path.AddArc(8, 256 - 8 - $r, $r, $r, 90, 90); $path.CloseFigure()
$g.FillPath($bg, $path)
$font = New-Object System.Drawing.Font 'Segoe UI', 96, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$sf = New-Object System.Drawing.StringFormat; $sf.Alignment = 'Center'; $sf.LineAlignment = 'Center'
$g.DrawString('AI', $font, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF 0, 0, 256, 256), $sf)
$g.Dispose()
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$png = $ms.ToArray(); $bmp.Dispose()
$fs = [System.IO.File]::Create($ico)
$w = New-Object System.IO.BinaryWriter $fs
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]1)                 # ICONDIR
$w.Write([byte]0); $w.Write([byte]0); $w.Write([byte]0); $w.Write([byte]0)    # 256x256, tanpa palet
$w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$png.Length); $w.Write([uint32]22)
$w.Write($png); $w.Close()

$out = Join-Path $root 'AIOffice.exe'
& $csc /nologo /target:winexe /optimize+ /win32icon:$ico /out:$out /r:System.Windows.Forms.dll /r:System.Drawing.dll (Join-Path $PSScriptRoot 'AIOffice.cs')
if ($LASTEXITCODE -ne 0) { throw "Build gagal (kode $LASTEXITCODE)" }
$f = Get-Item $out
"Berhasil: $($f.FullName) ($([math]::Round($f.Length / 1KB, 1)) KB)"
