# Scripts

Semua harus bisa dijalankan dari PowerShell di Windows.

| Script | Fungsi | ID |
| --- | --- | --- |
| `start-paperclip.ps1` | Menjalankan/menghentikan/cek server Paperclip | F0.1 |
| `install-division.mjs` | Pasang company, agent, dan instruksi division ke Paperclip (idempoten) | F0.3 / F1.1 |
| `render-spike.mjs` | Uji render HTML → PNG 1080×1350 + cek determinisme | F0.7 |
| `smoke-test.mjs` | Verifikasi menyeluruh keadaan Fase 0 (37 cek, tanpa menjalankan agent; `--with-core-hash` menambah hash core ~90 dtk) | F0.6 |
| `render` | Render `carousel-design.json` ke PNG secara manual untuk debug | F1.8 |
| `kpi-report` | Buat laporan KPI mingguan | F2.5 |

## start-paperclip.ps1

Paperclip tidak mendukung Windows service (`doctor`: "Service management is not supported on win32"),
jadi server dijalankan sebagai proses biasa. Script ini menjalankannya **detached** supaya tidak ikut
mati ketika shell pemanggil ditutup.

```powershell
.\scripts\start-paperclip.ps1             # start detached
.\scripts\start-paperclip.ps1 -Status     # cek hidup/mati
.\scripts\start-paperclip.ps1 -Stop       # hentikan
.\scripts\start-paperclip.ps1 -Foreground # jalankan di shell ini
```

Log server: `workspace/paperclip-server.out.log` dan `.err.log` (tidak di-commit).

## install-division.mjs

Sumber kebenaran adalah file di `divisions/<key>/`, bukan state di dalam Paperclip.
Script membaca `division.json` + file instruksi, lalu membuat atau memperbarui company dan agent.

```powershell
node scripts/install-division.mjs                  # pasang divisions/edukasiai
node scripts/install-division.mjs --dry-run        # tampilkan rencana saja
node scripts/install-division.mjs --division edukasiai --api-base http://127.0.0.1:3177
```

**Idempoten.** Dijalankan berulang tidak membuat company atau agent ganda; agent yang sudah ada
diperbarui agar isinya kembali sama dengan file di repo (AC1.1).

### Kenapa Node, bukan PowerShell

Versi PowerShell sempat dibuat lalu dibuang. `Invoke-RestMethod` di PowerShell 5.1 **menggantung
tanpa batas** untuk body JSON yang panjang sekaligus mengandung karakter non-ASCII (teks Indonesia
dengan `≥`, `—`, `×`): Content-Length tidak cocok dengan byte UTF-8 yang dikirim, server menunggu
sisa body yang tidak pernah datang, dan `-TimeoutSec` tidak menolong. Request bahkan tidak pernah
tercatat masuk di log server.

Node `fetch` dengan `Buffer.byteLength` mengirim Content-Length yang benar. CLAUDE.md aturan 8
mengizinkan script Node lintas platform. Detail bukti: `reports/build/2026-10-04_F0.3.md`.

## smoke-test.mjs

Menjalankan ulang cek penting F0.1–F0.7 dalam satu perintah supaya regresi cepat ketahuan.
**Tidak** membuat run agent, jadi tidak membakar kuota.

```powershell
node scripts/smoke-test.mjs
```

Keluar dengan kode 1 bila ada yang gagal. Terakhir: 37 PASS, 0 FAIL (2026-10-08).

## render-spike.mjs

Harness F0.7. Merender satu template ke PNG 1080×1350, membaca dimensi dari header PNG
(bukan percaya viewport), lalu membandingkan SHA-256 dua render.

```powershell
node scripts/render-spike.mjs
```

Prasyarat: `npx playwright install chromium` **dan** `npx playwright install chromium-headless-shell`.
Hanya memasang `chromium` saja tidak cukup untuk mode headless di Playwright 1.56.

## loop-status.js dan loop.ps1 (loop engineering)

```powershell
node scripts/loop-status.js                # ringkasan loop
node scripts/loop-status.js --check        # validasi loop/backlog.json
node scripts/loop-status.js --next         # task berikutnya
node scripts/loop-status.js --write-status # tulis ulang STATUS.md
node scripts/loop-status.js --pause        # owner: jeda loop
node scripts/loop-status.js --resume       # owner: lanjutkan loop
powershell -ExecutionPolicy Bypass -File scripts\loop.ps1 -MaxIterations 20   # mode tanpa pengawasan
```

Aturan lengkap: `loop/LOOP.md`. File ini dan `loop.ps1` tidak boleh diubah Claude Code.
