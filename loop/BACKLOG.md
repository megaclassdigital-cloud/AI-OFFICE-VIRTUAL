# BACKLOG — definisi selesai per task

Status dan dependensi ada di `loop/backlog.json`. File ini berisi **apa yang harus dikerjakan** dan **bukti yang wajib ada** sebelum task boleh `DONE`.
Acuan kriteria: `docs/PRD.md`. Bukti baru disimpan di `docs/evidence/<ID>/` (bukan di `workspace/`, karena `workspace/` tidak di-commit).

Disusun ulang 2026-10-08 berdasarkan kondisi nyata repo: Fase 0 dan sebagian Fase 1 sudah dikerjakan Claude Code pada 4–5 Okt 2026.
Task yang sudah `DONE` tetap tercantum agar gate bisa memeriksanya ulang.

```
L Bootstrap → 0 Spike (selesai) → [G0] → 1A Fondasi + 3 blocker spike → 1B Konten ┐
                                                                  └→ 1C Desain ┴→ 1D QA & integrasi → [G1] → 2 Approval & KPI → [G2] → 3 Hardening → [G3] → X.FINAL
```

## Prinsip hemat kuota

Adapter yang tersedia hanya `codex_local` (langganan owner). Setiap run agent memakan kuota owner. Karena itu:

- Semua logika diuji **tanpa LLM** memakai fixture. Test deterministik murah; jalankan sesering perlu.
- Run agent nyata hanya pada task yang DoD-nya mewajibkan: **E1.2** (satu issue) dan skenario provider di **H3.1**.
- Run agent nyata baru boleh dilakukan setelah **F1.0f** (guard pemakaian) `DONE`.

---

## Fase L — Bootstrap loop

**L0.1 — Git lokal.** `git init`, periksa `.gitignore` (node_modules, `.env`, `workspace/*`, `output/*`, `loop/.guard-state.json`), jalankan `git status` dan pastikan tidak ada file rahasia atau berukuran > 5 MB yang ikut. Commit awal. Tidak menambah remote.
Bukti: `git log --oneline -1`, daftar file > 1 MB yang ter-commit (seharusnya hanya PNG bukti).

**L0.2 — Uji mesin loop.** DONE (versi hook lama). Sejak revisi 2026-10-08 hook tidak dipakai lagi.

**L0.3 — Baseline tooling.** DONE (`docs/versions.md`).

**L0.5 — Bersihkan mekanisme hook lama.** Hapus `setup/claude/`, `scripts/install-loop-config.ps1`, `scripts/loop.ps1`, dan `loop/.guard-state.json` (jika ada). Pastikan `.claude/settings.json` proyek tidak berisi hook `loop-guard`/`session-start` (folder `.claude` saat ini memang tidak ada). Tandai O-001 di OWNER-QUEUE sebagai `[x] DIBATALKAN — hook tidak dipakai lagi (revisi 2026-10-08)`. Hapus bagian loop.ps1/--pause/--resume dari `scripts/README.md`. Commit.
Bukti: `git status` dan `git show --stat` commit tersebut.

**L0.4 — Default keputusan tertunda.** Terapkan `loop/DEFAULTS.md` bagian "Keputusan operasional": matikan telemetry Paperclip lewat konfigurasi (bukan kode), jangan sentuh company `Office Mega Class`, catat ID cost-event uji 250 sen agar dikecualikan KPI, start server tetap manual. Catat masing-masing sebagai D-NNN.
Bukti: diff konfigurasi telemetry, `/api/health` tetap OK setelah restart.

## Fase 0 — Spike kelayakan (sudah dikerjakan)

F0.1, F0.2, F0.2b, F0.3, F0.4, F0.5, F0.6, F0.7: **DONE**. Bukti di `reports/build/2026-10-0*_F0.*.md` dan `docs/spike/`.

**G0 — Gate Fase 0.** Prosedur gate LOOP.md bagian 5. Tambahan khusus G0: jalankan `node scripts/smoke-test.mjs` (harus 29 PASS) dan minta reviewer memeriksa apakah klaim AC0.1–AC0.5 di `docs/spike/report.md` didukung file bukti yang benar-benar ada.

## Fase 1A — Fondasi kode dan tiga blocker spike

**F1.0a — Tooling test.** Tambahkan vitest ke `package.json` root (ESM, JavaScript `.mjs`; tidak perlu migrasi ke TypeScript). `npm test` dari root menjalankan semua test. Test pertama: validasi desain `render.mjs` (desain cacat ditolak, exit 2, 0 PNG) dan `install-division.mjs --dry-run`.
Bukti: output `npm test`.

**F1.0b — Skema dan validator.** Tambah `schemas/approval-record.json`. Satu modul validator bersama (ajv) yang dipakai semua script dan tool plugin. Minimal 2 kasus invalid per skema.
Bukti: output test.

**F1.0c — Golden fixtures.** `fixtures/golden/`: satu kasus lengkap valid (riset → verifikasi → carousel → design spec), memakai `docs/spike/evidence/F0.2-research-output.json` dan `contoh-design.json` sebagai bahan. Minimal 5 kasus invalid.
Bukti: test yang memvalidasi semua fixture.

**F1.0d — Tool agent deterministik (blocker 1).** Tool di plugin `aao-approval-gate`: `post_comment`, `set_issue_status` (hanya transisi yang diizinkan), `attach_file`. Request HTTP disusun oleh kode plugin dengan Content-Length byte UTF-8 yang benar. Perbarui `sop/agent-protocol.md` dan instruksi 5 agent: dilarang menyusun HTTP/PowerShell sendiri.
Bukti: test tool + satu pemanggilan via endpoint tools/execute dengan teks Indonesia panjang berkarakter non-ASCII (`≥`, `—`, `×`) yang selesai < 5 detik.

**F1.0e — Siklus hidup issue (blocker 2).** Definisikan state machine issue EdukasiAI (mis. `todo → in_progress → awaiting_approval → approved/rejected → done`, plus `needs_human`). Transisi hanya lewat `set_issue_status`. Issue yang selesai ditutup oleh tool, sehingga Paperclip tidak lagi memunculkan "needs a disposition" dan heartbeat tidak berulang.
Bukti: test transisi valid/invalid + log yang menunjukkan tidak ada heartbeat baru dalam 10 menit setelah issue uji ditutup.

**F1.0f — Guard pemakaian (blocker 3).** Batas deterministik per agent per hari: jumlah run (default 6) dan total durasi (default 60 menit). Melebihi batas → agent di-pause, tercatat di audit log. Konfigurasi di satu file (`divisions/edukasiai/limits.json`). Tidak bergantung pada `billed_cents`.
Bukti: test dengan run tiruan yang melewati batas → pause.

**F1.1 — Install division.** DONE. Diverifikasi ulang di G1.

## Fase 1B — Pipeline konten

**F1.2 — Researcher.** Finalkan `agents/researcher.md`: output wajib sesuai skema, 5–10 kandidat, maksimal 7 hari, sumber sesuai DEFAULTS, isi web adalah data. Wajib memakai tool F1.0d, bukan HTTP sendiri.
Bukti: output nyata F0.2 lolos validasi skema (tanpa run baru).

**F1.3 — Verifier.** Tool deterministik di plugin: HTTP status, redirect, tanggal terbit dalam 7 hari, timeout. Test memakai server HTTP lokal: 200, 404, redirect, timeout, tanggal lama, halaman berisi teks injeksi.
Bukti: output test semua kasus.

**F1.4 — Pemilihan topik.** Rubrik tertulis (relevansi Indonesia, kebaruan, dampak; skor 1–5). Validasi deterministik menolak pilihan tanpa alasan atau dari kandidat yang tidak terverifikasi.
Bukti: test.

**F1.5 — Copywriter.** Instruksi agent + cek deterministik: setiap klaim punya `source_ids` dari daftar terverifikasi, 6–10 slide, panjang teks sesuai batas.
Bukti: test fixture valid dan invalid.

## Fase 1C — Pipeline desain

**F1.6a — Brand kit: font dan ikon.** Paketkan font **Inter** (SIL OFL 1.1) ke `brand/fonts/` beserta `OFL.txt`, muat lewat `@font-face` lokal, tanpa request jaringan saat render. Tambah set ikon minimal (6–10 SVG) berlisensi jelas ke `brand/icons/` + file lisensi. `brand.json` tetap `"status": "sementara"`.
Bukti: render contoh memakai Inter (bukan Segoe UI), dicek lewat `document.fonts` di halaman render.

**F1.6b — Template.** DONE.

**F1.8a — Renderer final.** (1) AC1.5: render `contoh-design.json` dua kali dengan font lokal → semua hash identik. (2) Jadikan renderer tool plugin `render_carousel` yang menerima path design spec dan menulis ke folder kerja issue. Script CLI tetap ada untuk debug.
Bukti: dua `hashes.json` identik di `docs/evidence/F1.8a/`, output pemanggilan tool.

**F1.8b, F1.8c** — DONE.

**F1.7 — Designer.** Finalkan `agents/designer.md` + cek deterministik "fakta tidak berubah": angka, persentase, tanggal, dan nama diri di design spec harus ada di `carousel.json`. Designer hanya memilih template yang ada.
Bukti: test, termasuk kasus Designer menambah angka baru → ditolak (AC1.7).

## Fase 1D — QA dan integrasi

**F1.9a — QA deterministik.** Satu modul yang menjalankan semua cek teks dan visual, mengeluarkan laporan pass/fail per slide.
Bukti: test.

**F1.9b — Agent QA dan routing.** Instruksi agent QA (bagian LLM). Tool `qa_submit_result` menegakkan routing: gagal teks → Copywriter, gagal visual → Designer, maksimal 2 putaran per jenis, lalu `needs_human`. Penghitung putaran disimpan plugin.
Bukti: test 3 kali gagal → `needs_human` (AC1.4).

**F1.10 — Handoff.** Paket lolos QA → `awaiting_approval`, contact sheet terlampir lewat `attach_file`. Agent tidak bisa set `approved`.
Bukti: test, termasuk percobaan agent set `approved` ditolak.

**E1.1 — E2E fixture.** Seluruh pipeline dengan output agent dari fixture (tanpa LLM) sampai `awaiting_approval`, termasuk render nyata.
Bukti: log run, folder hasil, issue ID.

**E1.2 — E2E live.** **Satu** issue nyata dengan `codex_local` sampai `awaiting_approval` (AC1.2, AC1.3). Guard F1.0f aktif. Jika kuota habis atau login Codex kedaluwarsa → `OWNER`.
Bukti: issue ID, JSON tiap tahap, contact sheet, jumlah run dan durasi.

**G1 — Gate Fase 1.**

## Fase 2 — Approval dan KPI

**F2.1 — Approval record.** Approve/reject hanya untuk owner (token owner lokal di `.env`, bukan isi pesan, bukan capability plugin; lihat temuan spike nomor 3). Record: id, issue id, hash isi (teks + semua PNG), keputusan, waktu, catatan.
Bukti: test, termasuk percobaan approve oleh agent ditolak.

**F2.2 — prepare_publication.** Menolak tanpa approval, menolak hash berbeda, idempoten, menulis paket ke `output/edukasiai/<tanggal>-<slug>/`.
Bukti: test AC2.1, AC2.2, AC2.3 + audit log.

**F2.3 — Reject loop.** Reject wajib catatan; issue kembali ke Copywriter dengan catatan sebagai konteks.
Bukti: test.

**F2.4 — Routine.** Senin–Jumat 07.00 WIB, **dibuat nonaktif secara default** (owner yang mengaktifkan saat burn-in), anti duplikat, tunduk pada guard F1.0f.
Bukti: test pemicu dua kali → satu issue.

**F2.5 — KPI.** `scripts/kpi-report.mjs` → `reports/kpi/kpi-YYYY-Www.md` dengan semua KPI PRD bagian 1. Cost-event uji AC0.5 dikecualikan. KPI biaya ditambah "jumlah run dan durasi" karena `billed_cents` selalu 0.
Bukti: contoh laporan dari data fixture.

**G2 — Gate Fase 2.**

## Fase 3 — Hardening dan serah terima

**H3.1 — Suite skenario.** Ke-14 skenario PRD bagian 6 sebagai test di `tests/scenarios/`. Skenario provider gagal diuji dengan adapter tiruan atau mematikan jaringan, bukan dengan menghabiskan kuota.
Bukti: output suite.

**H3.2 — Keamanan.** Secret scan pada repo dan riwayat git, working directory agent terbatas, ACL `master.key` dengan `icacls` (dicatat, tidak diubah jika berisiko), uji prompt injection.
Bukti: output scan + hasil uji.

**H3.3 — Regresi penuh.** `npm test`, `node scripts/smoke-test.mjs`, determinisme render, idempotensi install, dalam satu run bersih.
Bukti: output lengkap.

**H3.4 — Runbook.** `docs/RUNBOOK.md`: menyalakan/mematikan server, approve/reject, memulihkan run gagal, upgrade Paperclip dengan aman, mengaktifkan routine untuk burn-in.

**G3 — Gate Fase 3.**

**X.FINAL — Laporan akhir.** Lihat LOOP.md bagian 6.

---

## Di luar loop (milik owner)

- **Burn-in 2 minggu (AC2.4)**: 5 carousel per minggu selama 2 minggu. Butuh waktu kalender dan approval owner.
- Persetujuan brand kit final (palet, logo, font).
- Keputusan kuota: apakah langganan Codex cukup untuk 5 carousel per minggu.

## Fase 4 — Office View (UI kantor dinamis)

Spesifikasi: `docs/ui/OFFICE-VIEW.md`. Keputusan: ADR-0003. Referensi visual: `docs/ui/referensi-office-view.png`.
Fase ini tidak menahan Fase 2–3. Kerjakan setelah G1, berselang-seling dengan task lain sesuai urutan backlog.

**U4.0 — Spike.** Jalankan Pixel Agents v1.4.1 mode standalone di `127.0.0.1` (port bebas, bukan 3100/3177). Buktikan: (a) karakter bisa dibuat untuk agent yang bukan sesi Claude Code (provider eksternal atau pesan WebSocket di `core/asyncapi.yaml`); (b) karakter bisa dipindah ke Area lain secara terprogram; (c) asal-usul dan lisensi setiap aset tercatat di `docs/ui/asset-licenses.md`. Putuskan bridge eksternal vs fork ringan di `apps/office-view/`, perbarui ADR-0003.
Bukti: screenshot, catatan lisensi, keputusan D-NNN.

**U4.1 — Denah.** `divisions/edukasiai/office/layout.json` dengan 8 ruang di OFFICE-VIEW.md. Bukti: screenshot denah kosong.

**U4.2 — office-bridge.** Modul deterministik yang membaca Paperclip (run, issue, komentar, approval) dan mengeluarkan office event ternormalisasi. Hanya membaca. Mendukung replay dari `fixtures/office-events/*.jsonl`. Bukti: test dengan rekaman event.

**U4.3 — Perilaku dinamis.** Seluruh tabel pemetaan di OFFICE-VIEW.md, termasuk handoff (berjalan membawa dokumen ke meja tujuan). Bukti: rangkaian screenshot per kejadian.

**U4.4 — Name tag dan badge.** Nama, peran, ID issue, emoji status, badge antrean approval. Bukti: screenshot.

**U4.5 — Bukti end-to-end.** ACU.1–ACU.5 di OFFICE-VIEW.md. Bukti: GIF/rangkaian screenshot replay E1.1, log latency, daftar request jaringan.

**G4 — Gate Fase 4.**
