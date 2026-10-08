# Review gate G0 — Fase 0 (spike kelayakan)

- Tanggal: 2026-10-08
- Reviewer: subagent independen (konteks bersih), berpedoman pada `setup/claude/agents/reviewer.md`.
  Memakai agent bertipe umum karena subagent `reviewer` resmi belum terpasang di `.claude/` (O-001).
- Catatan: bagian "Laporan reviewer" adalah teks reviewer **apa adanya**. Tanggapan implementer ada di bagian paling bawah.

---

## Laporan reviewer

VERDICT: PASS WITH CONCERNS

Ini batas FAIL. Tidak ada secret, tidak ada perubahan core, dan smoke test 29/29 PASS. Tetapi bukti mentah AC0.2, AC0.3 dan AC0.5 tidak ada di docs/spike/evidence/. Yang ada hanya salinan tempel di laporan build. Kalau "bukti valid" dibaca sebagai berkas mentah, F0.2 dan F0.5 melanggar syarat FAIL. FIX-G0-01 dan FIX-G0-02 sebaiknya dikerjakan sebelum G0 ditandai DONE.

WHAT WORKS:
- Smoke test: dijalankan sendiri oleh reviewer; hasil asli "RINGKASAN: 29 PASS, 0 FAIL". Server menjawab, versi 2026.1001.0; company EdukasiAI dan IsolationTest ada; EdukasiAI punya 5 agent, semua timeoutSec 600; isolasi aktual: kontrol 200, baca dan tulis lintas company 403; plugin ready dan tool aao_hello terdaftar; PNG 1080x1350 dengan hash cocok.
- AC0.1: F0.1-health.json dan F0.1-cli-health-port3177.txt memuat status ok, bootstrapStatus ready. F0.1-onboard-retry.log memuat "Applying 282 pending migrations". Dua screenshot ada.
- AC0.4: F0.4-plugin-tool-proof.txt memuat plugin ready, eksekusi tool HTTP 200 dua kali, dan hash core sebelum/sesudah identik. Reviewer memeriksa independen: tidak ada berkas di @paperclipai/server/dist yang lebih baru dari 2026-10-04 19:00.
- F0.7: PNG berdimensi 1080x1350, hash cocok dengan F0.7-render-report.json (dua render identik). Dimensi dibaca dari header PNG.
- Kejujuran laporan: docs/spike/report.md mengakui AC0.5 hanya lolos karena biaya disuntikkan, adapter bukan free tier, ledger tercemar 250 sen, plugin bukan sandbox, dan agent belum diuji memanggil tool lewat LLM.
- Secret dan remote: grep pcp_, sk-, AKIA, ghp_, BEGIN PRIVATE KEY pada seluruh berkas ter-track nihil (satu-satunya kecocokan adalah teks di reports/build/L0.1.md yang menyebut polanya). git ls-files tidak memuat node_modules, .env maupun master.key. `git remote -v` kosong. Tidak ada salinan core. Working tree bersih (HEAD 9e70698).
- Plugin generik: plugins/aao-approval-gate/src/plugin.js hanya berisi tool aao_hello; tidak ada logika EdukasiAI.
- Otoritas LLM: tidak ada. Satu-satunya tool plugin adalah aao_hello.
- DECISIONS.md: D-001 sampai D-007 tidak ada yang memenuhi HARD STOP LOOP.md bagian 7.

WHAT IS WRONG:
- AC0.5-EVIDENCE — Tidak ada berkas bukti AC0.5 di docs/spike/evidence/ (tidak ada F0.5-*). report.md menulis "Status agent idle → paused, policy hard_stop", tetapi satu-satunya jejaknya adalah salinan tempel di reports/build/2026-10-05_F0.3-F0.5.md. PRD meminta "Status agent paused + log". Smoke test juga tidak memeriksa ini.
- AC0.2-EVIDENCE — report.md dan build report F0.2 menyebut docs/spike/evidence/F0.2-heartbeat-run.log sebagai bukti 3m18s dan costCents=0. Isi berkas itu sebenarnya run MANUAL kedua d3280774 yang masih status "queued", usageJson null, selesai 8,2 detik. Run sukses a80074bd (3m18s, costCents=0, subscription_included) hanya ada sebagai teks di reports/build/2026-10-04_F0.2.md. Berkas bukti yang dirujuk tidak mendukung klaimnya.
- AC0.3-OVERCLAIM — report.md menulis "5 endpoint lintas company ditolak 403... tidak ada data terbentuk". F0.3-isolation-proof.txt hanya memuat 3 penolakan (1 tulis, 2 baca) ditambah 1 kontrol. Dashboard, costs, dan pemeriksaan ulang tidak adanya issue penyusup hanya ada di narasi build report. Inti AC0.3 tetap terbukti, tetapi angka "5" melebihi isi berkas bukti.
- AC0.4-WEAK — PRD meminta `git status` repo Paperclip bersih. Penggantinya hash dari nama, ukuran dan mtime. Diakui di laporan, tetapi mtime bukan hash isi, dan skrip penghitung hash tidak disimpan di repo; angka BEFORE/AFTER hanya teks, tidak bisa diulang. PRD juga meminta "agent bisa memanggil tool", sedangkan yang terbukti adalah eksekusi lewat API. Diakui di bagian "tidak bisa diverifikasi" pada build report, tetapi tabel ringkasan report.md tidak menyebutnya, jadi PASS AC0.4 terbaca lebih kuat daripada buktinya.
- AC0.5-SEMANTIC — AC0.5 lolos hanya dengan biaya sintetis (biller test-harness). Terbuka di laporan, tetapi tabel "Hasil per kriteria" tetap menulis PASS tanpa catatan "sintetis".
- GATE-PROCESS — loop/OWNER-QUEUE.md O-001: hook .claude/ dan subagent reviewer resmi belum terpasang. Review ini berjalan tanpa hook loop-guard. Dicatat, bukan pelanggaran.

RISK:
- Pembaca G0 berikutnya bisa mengira AC0.2 dan AC0.5 terbukti oleh berkas di docs/spike/evidence/, padahal tidak.
- Anti-loop F0.2b hanya mitigasi sementara. Perbaikan akar (F1.0d) belum dibangun, jadi Fase 1B tetap bergantung pada kepatuhan LLM sampai F1.0d selesai.
- Guard biaya F1.0f belum ada. billed_cents selalu 0 dengan codex_local, sehingga tidak ada pembatas pemakaian nyata.
- Plugin pulih dari status error pasca-boot hanya lewat Repair-Plugins di scripts/start-paperclip.ps1 (D-007). Start manual di luar skrip itu meninggalkan plugin error.
- Isolasi hanya diuji dengan agent key. Akses board/owner lintas company by design.

MISSING TEST:
- Agent LLM benar-benar memanggil tool plugin di tengah run (diakui belum).
- Pause budget saat run sedang aktif (diakui belum).
- Smoke test tidak memeriksa AC0.2 (biaya nol), AC0.5 (status paused) maupun hash core. Hanya 3 dari 5 AC punya cek otomatis.
- `npm test` belum ada (F1.0a), tidak dihitung sebagai kegagalan.

REGRESSION RISK:
- Smoke test bergantung pada server hidup dan data live. Kalau DB di-reset, cek isolasi dan struktur gagal tanpa petunjuk jelas.
- F0.7 bergantung pada Chromium Playwright 1.56.0 yang dipin; determinisme hanya diuji pada mesin yang sama.
- Impor dingin SDK plugin ~7,9 detik, batas core 15 detik. Boot ulang di CPU 2 core rawan gagal lagi (D-007).

RECOMMENDED FIX:
- FIX-G0-01: Simpan bukti mentah AC0.5 dan run sukses AC0.2 ke docs/spike/evidence/ (F0.5-budget-pause.txt: sebelum, sesudah, overview policy; F0.2-run-succeeded.txt: usageJson run a80074bd dan costs/by-agent), lalu perbarui rujukan di report.md dan reports/build/2026-10-04_F0.2.md dari F0.2-heartbeat-run.log ke berkas yang benar.
- FIX-G0-02: Koreksi docs/spike/report.md agar tabel AC memuat catatan: AC0.5 "PASS mekanisme, biaya disuntikkan", AC0.4 "tool dieksekusi via API, belum dipanggil agent", dan angka AC0.3 sesuai isi F0.3-isolation-proof.txt.
- FIX-G0-03: Simpan skrip penghitung hash core ke scripts/ dan jalankan lagi, simpan sebagai bukti yang bisa diulang. Pertimbangkan hash isi berkas, bukan mtime.
- FIX-G0-04: Tambahkan cek smoke test untuk status agent bukan paused dan spendCents yang sengaja dikecualikan (ledger uji D-004), supaya AC0.2 dan AC0.5 tidak hanya terbukti di narasi.

DO NOT BUILD YET:
- Jangan mulai F1.2, F1.3, F1.5 dan seterusnya sebelum F1.0d (tool deterministik) dan F1.0f (guard pemakaian) selesai.
- Jangan menjadwalkan routine harian (F2.4) atau menyalakan produksi sebelum F1.0f ada.
- Jangan membuat tool approval, publikasi atau status approved sebelum G1.
- Jangan mengubah kode Paperclip untuk menutup masalah timeout 15 detik (larangan ADR-0001).

---

## Tanggapan implementer (2026-10-08)

Semua temuan valid dan **sudah dikerjakan sebelum G0 ditandai DONE**. LOOP.md bagian 8 sebenarnya mengizinkan lanjut pada PASS WITH CONCERNS, tetapi temuan ini menyangkut kejujuran bukti saya sendiri.

| Rekomendasi | Tindakan | Bukti |
| --- | --- | --- |
| FIX-G0-01 | `scripts/collect-g0-evidence.mjs` mengambil bukti mentah dari server. Run `a80074bd`: `succeeded`, 198 dtk, `subscription_included`. Log audit server mencatat `budget.hard_threshold_crossed` (limit 1, teramati 250) lalu `agent.resumed` | `docs/spike/evidence/F0.2-run-succeeded.json`, `F0.5-budget-pause.json`; rujukan di build report F0.2 dikoreksi |
| FIX-G0-02 | Tabel `docs/spike/report.md` dikoreksi (AC0.2 rujukan benar, AC0.3 "3 di berkas + dicek ulang smoke", AC0.4 "terbatas", AC0.5 "sintetis") + bagian "Koreksi hasil review G0" | `docs/spike/report.md` |
| FIX-G0-03 | `scripts/core-hash.mjs`: SHA-256 atas ISI 9350 berkas core; `--check` terbukti identik pada run kedua | `docs/evidence/G0/core-hash-baseline.json` |
| FIX-G0-04 | `smoke-test.mjs`: 29 → 37 cek (agent tidak `paused`, tidak ada biaya nyata di luar event uji, isolasi 5 endpoint, key uji dicabut, opsi `--with-core-hash`) | `docs/evidence/G0/smoke-test.txt` |

Dua temuan tambahan saat memperbaiki: (1) cek `apiRunCount = 0` gagal karena cost-event sintetis uji AC0.5 terhitung satu "API run"; asumsinya saya koreksi (`= 1`, itu event D-004). (2) smoke test lama membuat API key baru di setiap run tanpa mencabutnya; sekarang dicabut.

Keberatan reviewer yang **tidak** bisa diperbaiki sekarang: (a) agent belum pernah memanggil tool plugin di tengah run, itu baru bisa di F1.0d/E1.2; (b) baseline hash core dibuat setelah plugin terpasang, jadi hanya membuktikan "tidak berubah sejak baseline" (disebut terbuka di komentar `core-hash.mjs`).
