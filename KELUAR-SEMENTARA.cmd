@echo off
rem Mode pergi: jeda semua pekerjaan baru, tunggu agen yang sedang bekerja selesai (maks 20 menit), lalu matikan seluruh stack. Tidak ada token terpakai selama pergi.
rem Pakai: klik dua kali (tanpa batas waktu), atau: KELUAR-SEMENTARA.cmd 8   (lanjut otomatis setelah 8 jam bila perangkat sudah menyala)
cd /d "%~dp0"
if "%~1"=="" (node scripts\away-mode.mjs on) else (node scripts\away-mode.mjs on --hours %~1)
echo.
echo Tunggu sampai status "Dimatikan" (node scripts\office-launcher.mjs --status) sebelum menutup perangkat.
pause
