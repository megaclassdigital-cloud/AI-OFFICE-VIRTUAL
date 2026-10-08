# CLAUDE.md — AI Agent Office

Kamu (Claude Code, model Sonnet) adalah implementation engineer untuk proyek ini.
Owner: Farrel. Reviewer arsitektur: Claude (chat), membaca hasil loop setelah loop selesai.

## MODE KERJA: LOOP ENGINEERING

Selama `loop.status` di `loop/backlog.json` bernilai `RUNNING`, kamu bekerja **otonom** sesuai `loop/LOOP.md`:
task demi task, sampai backlog habis, **tanpa bertanya ke owner**. Baca `loop/LOOP.md` lengkap di awal setiap sesi.

Hook `SessionStart` menampilkan status loop dan task berikutnya. Hook `Stop` menolak usahamu berhenti selama masih ada
task yang bisa dikerjakan. Jika hook menahanmu, jangan berdebat dan jangan bertanya: kerjakan task yang disebutnya.

Jika `loop.status` bukan `RUNNING` (PAUSED, DONE, HARD_STOP, STALLED), kerjakan hanya apa yang diminta owner di sesi itu.

## Urutan baca di awal sesi

1. Output hook SessionStart (status loop dan task berikutnya).
2. `loop/LOOP.md` — aturan loop. Mengikat.
3. `loop/BACKLOG.md` — DoD task yang sedang dikerjakan.
4. `loop/DEFAULTS.md` dan entri terbaru di `loop/DECISIONS.md`.
5. Bagian `docs/PRD.md` dan ADR di `docs/decisions/` yang relevan dengan task.

## Konteks singkat

- Core platform: **Paperclip** (https://github.com/paperclipai/paperclip, MIT), dipasang terpisah dan **tidak di-fork** (ADR-0001).
- Folder ini adalah repo kita: plugin, template division, skema, script, dokumen, laporan, state loop.
- Division pertama: **EdukasiAI**, membuat carousel berita AI (copywriting + gambar slide).
- Agent: Researcher, Verifier, Copywriter, Designer, QA. Gambar dibuat **renderer deterministik** dari template (ADR-0002).
- Lingkungan owner: Windows, PowerShell. Semua script harus jalan di PowerShell.

## Aturan teknis (berlaku juga di luar loop)

1. **Jangan pernah mengedit kode Paperclip.** Jika itu satu-satunya jalan, itu HARD STOP (LOOP.md bagian 7).
2. **Baca dokumentasi sebelum menebak API** Paperclip, plugin-sdk, adapter, Playwright. Gunakan versi yang terpasang.
3. **Tidak ada klaim tanpa bukti.** "Seharusnya bekerja" dan "build passed" bukan bukti perilaku.
4. **Test dulu untuk logika deterministik**: approval, hash, idempotensi, validasi skema, cek visual, routing QA.
5. **LLM tidak memegang otoritas** atas approval, status `approved`, paket publikasi, validasi URL/tanggal, dan render.
6. **Designer tidak menulis HTML/CSS bebas.** Hanya mengisi `carousel-design.json` dari template brand kit.
7. **Pin versi** di `docs/versions.md`. Upgrade hanya sebagai task terpisah dengan regression test.
8. **Tidak ada secret di repo.** API key di secrets Paperclip atau `.env`.
9. **Tidak ada posting otomatis** dan tidak ada `git push`.
10. **Plugin generik.** Logika khusus EdukasiAI hanya di `divisions/edukasiai/`, tidak di `plugins/`.
11. **Bahasa:** kode, komentar, nama file dalam bahasa Inggris. Konten carousel, instruksi agent, laporan, dan journal dalam bahasa Indonesia.

## Fakta lingkungan yang sudah terbukti (Fase 0, 4–5 Okt 2026)

Jangan menemukan ulang hal-hal ini. Sumber: `docs/spike/report.md`, `docs/versions.md`, dan arsip `docs/archive/STATUS-2026-10-05.md`.

1. **Paperclip di `http://127.0.0.1:3177`**, bukan 3100. Port 3100 milik ERP-KIOS owner, dan `localhost` di Windows mengarah ke `::1` lebih dulu, sehingga bisa diam-diam berbicara ke aplikasi lain. Selalu pakai `127.0.0.1`.
2. **Menjalankan server:** `.\scripts\start-paperclip.ps1` (detached), `-Status`, `-Stop`. Tidak ada Windows service dan tidak auto-start setelah reboot.
3. **Cek cepat regresi Fase 0:** `node scripts/smoke-test.mjs` (29 cek, tanpa run agent).
4. **Pasang/perbarui division:** `node scripts/install-division.mjs` (idempoten).
5. **Jangan pakai `Invoke-RestMethod` untuk POST berisi teks Indonesia panjang.** Request menggantung selamanya (Content-Length dihitung per karakter, bukan byte UTF-8). Pakai Node `fetch` dengan `Buffer.byteLength`, atau `curl.exe --data-binary "@file"`.
6. **Plugin wajib memakai pola `startWorkerRpcHost({ plugin })`**, bukan `runWorker()`. Deteksi main-module SDK gagal di Windows ini dan worker mati diam-diam setelah 15 detik.
7. **Versi dipin:** `paperclipai@2026.1001.0` (selalu tulis versinya di perintah `npx`), `playwright@1.56.0`, Chromium 1194, Node 24.19.0. Playwright butuh `chromium` **dan** `chromium-headless-shell`.
8. **Adapter:** `codex_local` (langganan Codex owner, kredensial di `~/.codex`), `timeoutSec: 600`, cwd `workspace/agent`. Biaya tercatat 0, jadi budget Paperclip tidak melindungi apa pun (lihat F1.0f).
9. **`tools/execute` mewajibkan `projectId`.** Project EdukasiAI: `Carousel Berita AI`.
10. **Jangan mematikan proses Node milik ERP-KIOS atau JARVIS** saat mengelola proses. Identifikasi proses lewat port 3177 atau path, bukan nama.
11. **Hapus folder output di Windows bisa gagal `EBUSY`.** Kosongkan isinya, jangan hapus foldernya.
12. **Company `Office Mega Class` bukan milik loop.** Jangan dibaca, diubah, atau dihapus.

## File yang tidak boleh kamu ubah

`CLAUDE.md`, `loop/LOOP.md`, `loop/DEFAULTS.md`, `loop/loop-lib.js`, `scripts/loop-status.js`, `scripts/loop.ps1`, `scripts/install-loop-config.ps1`, semua isi `.claude/` dan `setup/`.
Aturan ini juga ditegakkan oleh deny rule di `.claude/settings.json`. Jika menurutmu salah satu file itu keliru, catat sebagai `REVIEW-OWNER` di `loop/DECISIONS.md` dan lanjutkan.

## Struktur folder

```
AI-Agent-Office\
├── CLAUDE.md            # file ini
├── README.md            # peta folder
├── STATUS.md            # dibuat otomatis dari loop/backlog.json
├── .claude\             # settings.json (izin + hooks), hooks\, agents\reviewer.md
├── loop\                # LOOP.md, BACKLOG.md, backlog.json, DEFAULTS.md, DECISIONS.md, OWNER-QUEUE.md, journal\
├── docs\                # PRD.md, decisions\ (ADR), spike\, evidence\, versions.md, RUNBOOK.md
├── reports\             # build\ per task, review\ per gate, kpi\, LOOP-FINAL.md
├── plugins\aao-approval-gate\
├── divisions\edukasiai\ # agents\, sop\, brand\
├── schemas\  fixtures\  tests\  scripts\
├── workspace\           # working dir agent (gitignored)
└── output\              # paket publikasi (gitignored)
```
