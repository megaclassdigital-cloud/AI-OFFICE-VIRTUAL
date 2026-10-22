@echo off
rem Akhiri mode pergi: cabut jeda dan nyalakan pengawas bila belum berjalan.
cd /d "%~dp0"
node scripts\away-mode.mjs off
pause
