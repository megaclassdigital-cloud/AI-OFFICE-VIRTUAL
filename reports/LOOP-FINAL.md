# LOOP-FINAL — AI Agent Office (EdukasiAI di atas Paperclip)

Disusun 2026-10-09 oleh implementer (Claude Code), menurut `loop/LOOP.md` bagian 6.
Reviewer arsitektur membaca ini setelah loop berhenti.

## 0. Kesimpulan jujur

Semua yang **bisa dibuktikan tanpa menjalankan agent LLM nyata** sudah dibangun dan diuji. **MVP belum terbukti.** Jalur penuh Research → Verifikasi → Copywriting → Desain → QA → Approval dengan agent LLM nyata (AC1.2, AC1.3) belum pernah dijalankan, dan KPI "5 draf/minggu selama 2 minggu" (AC2.4) belum bisa diukur. Satu-satunya run LLM nyata di sesi ini (agent QA, untuk bukti Office View) gagal `setup_failed`; penyebabnya belum terbukti.

Loop berhenti karena sisa tugasnya hanya `OWNER`/`BLOCKED` (LOOP.md bagian 3).

- **Status tugas:** 60 DONE · 6 BLOCKED · 1 OWNER · 1 SKIPPED · 2 TODO (G4 menunggu U4.5; X.FINAL = laporan ini). Detail: `STATUS.md`.
- **Tes:** `docs/evidence/G3/npm-test.txt`: 27 file, **421 tes lulus**, exit 0 (456 dtk). `node scripts/smoke-test.mjs`: 37 PASS (H3.3). `npm run secret-scan`: 0 temuan di berkas dan seluruh riwayat git. **Catatan:** run 421 tes dilakukan saat CPU masih ramai oleh proses lain; angka acuan sebaiknya dari `npm test` yang dijalankan owner pada mesin idle (RUNBOOK §10b).

## 1. Ringkasan per fase dan bukti

| Fase | Hasil | Bukti utama |
| --- | --- | --- |
| L — Bootstrap loop | Loop, backlog, git lokal (tanpa remote, tanpa push). L0.5 BLOCKED (O-002) | `loop/`, `reports/build/L0.*` |
| 0 — Spike | Paperclip 2026.1001.0 di 127.0.0.1:3177, isolasi company, plugin menambah tool, render Chromium deterministik, `codex_local` satu-satunya adapter yang jalan; biaya selalu 0 (budget tidak melindungi) | `docs/spike/report.md`, `reports/review/G0-review.md` |
| 1A–1D — Pipeline | Skema, validator, state machine siklus hidup, guard pemakaian (run/menit), tool plugin (komentar, status, lampiran, verifikasi URL, render, QA, handoff), renderer deterministik 1080×1350 + contact sheet, QA deterministik + routing 2 putaran, E2E fixture sampai `in_review` | `reports/build/F1.*`, `docs/evidence/` |
| 2 — Approval & KPI | Record approval ber-HMAC (token owner), `owner-decide` (approve/reject + catatan, resume aman), `prepare-publication` (cek approval + hash, idempoten, kunci, audit log), routine harian nonaktif, laporan KPI mingguan | `reports/build/F2.*`, `FIX-G2-*`, `tests/owner-*.test.mjs`, `tests/prepare-publication.test.mjs` |
| 3 — Hardening | 14 skenario PRD sebagai tes (label cakupan jujur), pemindai secret, regresi penuh, RUNBOOK | `tests/scenarios/`, `reports/build/H3.*`, `docs/RUNBOOK.md` |
| Office View (U4.L + U4.1–4.4) | Kantor virtual pixel art LIVE dari data Paperclip nyata (`npm run office`), mode SIMULASI, read-only, 127.0.0.1 saja; bukti run nyata, pause/resume nyata, latensi data→UI 1,3–4,5 dtk | `reports/build/U4.L.md`, `docs/evidence/U4.L/` |
| Gate | G0, G1, G2, G3 semuanya PASS WITH CONCERNS; semua temuan dicatat dan ditanggapi | `reports/review/G*-review.md` |

Bug nyata yang ditemukan lewat pengujian dan sudah diperbaiki: agent bisa memalsukan `verification-result`/laporan render (FIX-G1-01..03), laporan render basi tersegel setelah render gagal (H3.1), record approval lama bisa diputar ulang lewat nama berkas (FIX-G3-01), `contact-sheet.png` tidak terikat hash (FIX-G3-03), hostname bertitik akhir dan rentang IPv6 lolos SSRF (FIX-G1-04, FIX-G3-04), karakter Office View melompat saat satu poll lambat.

## 2. Acceptance criteria (PRD bagian 6)

| AC | Status | Catatan |
| --- | --- | --- |
| AC0.1–AC0.5 | Terbukti (Fase 0) | Evidence G0 |
| AC1.1 install idempoten | Terbukti | H3.3: dibuat=0, 5 agent, 1 company |
| AC1.2 satu issue end-to-end sampai `awaiting_approval` dengan agent LLM nyata | **BELUM** | Hanya jalur kode/fixture (E1.1, skenario 1); E1.2 menunggu O-004 |
| AC1.3 semua sumber lolos verifikasi (agent nyata) | **BELUM** | Verifikasi kode terbukti; Verifier LLM belum |
| AC1.4 QA gagal 2× → `needs_human` | Terbukti (kode) | `tests/qa-routing.test.mjs` |
| AC1.5 render deterministik | Terbukti | H3.3: 6 PNG hash identik, contact sheet identik byte |
| AC1.6 teks meluber ditolak | Terbukti | skenario 12; ikon/aset hilang belum diuji |
| AC1.7 teks gambar = draf, tanpa fakta baru | Terbukti (kode) | `check-design` |
| AC2.1 prepare tanpa approval ditolak | Terbukti | audit log, termasuk penolakan nyata pada EDU-7 |
| AC2.2 draf diubah setelah approve ditolak | Terbukti | audit `hash_mismatch` |
| AC2.3 approve 2× → 1 folder | Terbukti | termasuk 3 proses paralel |
| AC2.4 5 draf/minggu 2 minggu berturut | **BELUM** | Butuh burn-in; data W41 hanya fixture |
| ACU.1, ACU.3, ACU.4, ACU.5 (Office View) | Terbukti | U4.L |
| ACU.2 replay pipeline E1.1 | **BELUM** | Replay dari fixture buatan tangan, bukan rekaman nyata |

## 3. Daftar REVIEW-OWNER (`loop/DECISIONS.md`)

D-006 logo EdukasiAI resolusi lebih besar/SVG · D-007 plugin `error` dipulihkan oleh skrip start (restart manual lain menyisakan error) · D-008 concern G0 · D-009 situs berita memblokir GET otomatis (403), tidak menyamar sebagai browser · D-010 QA di plugin mengimpor logika `scripts/` (kebocoran ringan aturan 10 CLAUDE.md; perlu parameterisasi sebelum division kedua) · D-011 contact sheet tidak bisa dilampirkan biner · D-012 Office Console di luar backlog · D-013 U4.L diprioritaskan · D-014 renderer Canvas sendiri, bukan Pixel Agents · D-015 rekonsiliasi U4.* · D-016 ADR-0003 usang dan cakupan U4.3 sebagian (owner diminta mengubah status ADR-0003) · **D-017 dua berkas owner (`scripts/loop-status.js`, ADR-0003) ikut ter-commit lokal tanpa sengaja; isi tidak diubah, tidak ada push**.

## 4. OWNER-QUEUE yang belum selesai

| ID | Isi | Akibat bila tidak dilakukan |
| --- | --- | --- |
| O-002 | `git rm -r setup/claude scripts/install-loop-config.ps1 scripts/loop.ps1` lalu commit | Hanya sisa file mati |
| O-004 | Izin SATU run LLM nyata (kuota Codex) + desain orkestrasi antar-agent | AC1.2/AC1.3 tak terbukti; tak ada burn-in |
| O-005 | `node scripts/install-routine.mjs` (nonaktif), `--enable` saat burn-in | Tidak ada pemicu harian |
| O-006 | Sumber tanggal terbit: agent atau diekstrak dari halaman | KPI akurasi sumber tidak boleh diklaim |
| **O-007** | Cara mengamankan token owner dan `tool-roles.json` dari agent (akun terpisah / sandbox terbukti) + reload plugin live | **HMAC dan gerbang peran adalah pagar tanpa kunci; jangan jalankan E1.2** |
| O-008 | Kebijakan kandidat 403 (D-009) | Sumber tertentu tak pernah bisa verified |
| (hook) | Tambahkan `"disableAllHooks": true` ke `C:\Users\Farrel\.claude\settings.json` atau matikan plugin `security-guidance` | Notifikasi error hook berulang (bukan temuan kode) |

## 5. Belum terbukti / risiko terbuka (jangan diklaim)

1. **Agent LLM nyata** memakai tool plugin sesuai instruksi (E1.2). Termasuk perilaku terhadap halaman injeksi prompt nyata.
2. **Sandbox `codex_local`** (FIX-G2-01b/G3-02): belum terbukti agent tak bisa membaca `.env`, menulis `output/approvals`, mengedit `tool-roles.json`, atau menjalankan `owner-decide`. `master.key` Paperclip terbaca akun yang sama dengan agent.
3. **Plugin live belum di-reload**: gerbang peran, segel render, dan penjaga SSRF baru berlaku setelah reload; worker yang berjalan masih kode lama.
4. **`owner-decide`/`prepare-publication`/`install-routine` terhadap Paperclip nyata**: baru klien tiruan (kecuali penolakan nyata `prepare-publication` pada EDU-7).
5. **`skip_if_active` routine** di server nyata, upgrade Paperclip (skenario 11), restart Paperclip di tengah run.
6. **API Paperclip menolak `done` dari kredensial agent** (FIX-G1-07) — hanya terbukti lewat tool plugin.
7. **Pinning IP DNS** (jendela TOCTOU antara cek DNS dan koneksi fetch).
8. **`published_at` dan `research-output` adalah masukan agent** (O-006): "akurasi sumber 100%" belum boleh diklaim.
9. **Run LLM nyata gagal `setup_failed`** (node -e ±24 dtk, CPU padat saat itu); tidak diselidiki lebih jauh. Saat review G3 diketahui satu penyebab beban CPU nyata: proses `find` dari perintah pencarian implementer sendiri (sudah dihentikan). Apakah itu juga penyebab `setup_failed` belum terbukti.
10. **KPI**: biaya per event `test-harness` dan pemindaian `output/edukasiai/` untuk paket tanpa audit belum; data W41 hanya fixture (diberi label).
11. Office View: Papan Tayang live, Ruang Rapat, ikon tool, pemetaan Rejected, pembacaan approval oleh bridge belum live (D-016).

## 6. Langkah memulai burn-in (AC2.4)

Urutan, masing-masing dengan keputusan/tindakan owner:
1. **O-007**: amankan token/peran, lalu reload plugin live dan buktikan satu panggilan tool dari agent yang salah ditolak. (Tanpa ini berhenti di sini.)
2. `node scripts\owner-approval.mjs init` (buat token) bila belum; jalankan `npm test` dan `node scripts\smoke-test.mjs` pada mesin idle sebagai acuan angka.
3. **O-004**: izinkan satu run nyata, mulai dari satu tahap (Researcher), amati perilaku terhadap instruksi (RUNBOOK §4). Selidiki `setup_failed` jika muncul lagi.
4. Setelah tahap-per-tahap lolos: rancang orkestrasi antar-agent, jalankan satu issue penuh sampai `in_review`, lalu `owner-decide` dan `prepare-publication` terhadap Paperclip nyata. Rekam event Office View untuk ACU.2 (membuka U4.5/G4).
5. **O-006, O-008**: putuskan sumber tanggal dan kebijakan 403.
6. **O-005**: `node scripts\install-routine.mjs`, lalu `--enable` hanya setelah langkah 1–5 beres. Pantau KPI mingguan (`node scripts\kpi-report.mjs`): target 5 draf/minggu selama 2 minggu berturut-turut, dan batasi pemakaian lewat `divisions/edukasiai/limits.json`.
7. Jangan membangun tombol approve di Console sebelum O-007 selesai.

## 7. Cara membaca repo

`README.md` (peta folder), `STATUS.md` (status otomatis), `docs/RUNBOOK.md` (operasi), `docs/PRD.md` (target), `loop/DECISIONS.md` dan `reports/review/` (alasan dan temuan), `reports/build/<ID>.md` (bukti per tugas).
