# DECISIONS — keputusan yang diambil Claude Code tanpa bertanya

Format dan aturan: `loop/LOOP.md` bagian 5. Nomor urut, tidak pernah dihapus; keputusan yang dibatalkan ditandai `DIGANTI oleh D-NNN`.
Label: `AUTO` (mudah dibalik) · `REVIEW-OWNER` (owner perlu melihat di laporan akhir) · `IDEA` (ide di luar scope, tidak dikerjakan).

<!-- Entri pertama dimulai dari D-001 di bawah baris ini. -->

## D-001 — Hapus `"type": "module"` dari package.json root
- Task: persiapan loop (sebelum L0.2)
- Konteks: `scripts/loop-status.js`, `loop/loop-lib.js`, dan hook loop adalah CommonJS dan tidak boleh diubah Claude Code. `package.json` root yang saya buat di F0.7 memuat `"type": "module"` sehingga semua `.js` di repo dianggap ESM dan `node scripts/loop-status.js` gagal (`require is not defined`).
- Pilihan: hapus `"type": "module"`. Semua script kita sudah berekstensi `.mjs` (ESM eksplisit), jadi tidak terpengaruh. Plugin punya `package.json` sendiri dengan `"type": "module"`.
- Alternatif: menaruh `package.json` CommonJS di `scripts/`, `loop/`, `.claude/` (ditolak: `.claude/` terlarang diubah, dan lebih rapuh).
- Biaya membalik: rendah
- Label: AUTO

## D-002 — Telemetry Paperclip dimatikan lewat konfigurasi
- Task: L0.4
- Konteks: quickstart menyalakan `telemetry.enabled: true`; data keluar mesin dan isinya belum diperiksa. DEFAULTS.md memerintahkan mematikannya.
- Pilihan: ubah `telemetry.enabled` jadi `false` di `~/.paperclip/instances/default/config.json` (konfigurasi pengguna, bukan kode Paperclip). Hanya satu field berubah; cadangan dan diff di `docs/evidence/L0.4/`.
- Alternatif: biarkan menyala (ditolak oleh DEFAULTS).
- Biaya membalik: rendah (ubah satu field lagi lalu restart)
- Label: AUTO

## D-003 — Company `Office Mega Class` tidak disentuh
- Task: L0.4
- Konteks: company OFF (`ae234524-417c-4a11-82da-e8dc35b8a4f3`) bukan dibuat loop dan tidak dipakai pipeline.
- Pilihan: biarkan apa adanya; tidak dibaca isinya, tidak diubah, tidak dihapus. Semua script memfilter berdasarkan ID company EdukasiAI/IsolationTest, bukan menghitung semua company.
- Alternatif: hapus atau pakai ulang (ditolak oleh DEFAULTS).
- Biaya membalik: tidak berlaku
- Label: AUTO

## D-004 — Ledger uji 250 sen dikecualikan dari KPI, bukan dihapus
- Task: L0.4
- Konteks: uji AC0.5 di F0.5 menyuntikkan satu cost-event sintetis 250 sen sehingga `costs/summary` menunjukkan `spendCents: 250` padahal pemakaian nyata USD 0.
- Pilihan: database tidak di-reset. ID cost-event uji: `5ecdb924-f298-4757-b3bb-5bbc4a38d788` (agent Researcher, provider `openai`, biller `test-harness`, model `gpt-test-harness`). `scripts/kpi-report.mjs` (F2.5) wajib mengecualikan event dengan `biller = "test-harness"` atau ID di atas.
- Alternatif: reset database (ditolak: menghapus data, dan riwayat issue/komentar ikut hilang).
- Biaya membalik: rendah
- Label: AUTO

## D-005 — Server Paperclip tetap start manual
- Task: L0.4
- Konteks: Paperclip tidak mendukung Windows service di win32. DEFAULTS: tanpa auto-start.
- Pilihan: `scripts/start-paperclip.ps1` (detached) dan didokumentasikan di RUNBOOK (H3.4). Tidak membuat Task Scheduler.
- Alternatif: Task Scheduler (butuh ADR dan menyentuh sistem di luar proyek).
- Biaya membalik: rendah
- Label: AUTO

## D-006 — Logo dari owner dipakai kecil; logo teks tetap cadangan
- Task: persiapan F1.6a
- Konteks: owner mengirim dua logo (EdukasiAI "eai_" putih di latar hitam; Mega Class Digital) sebagai PNG **150×150 px**. Kanvas slide 1080×1350 px, jadi memperbesar logo akan buram.
- Pilihan: simpan `divisions/edukasiai/brand/logo/edukasiai-logo.png` dan `docs/brand-assets/megaclassdigital-logo.png` apa adanya. Renderer memakai logo gambar hanya pada ukuran ≤ 96 px (resolusi asli ~1,5×) di footer; di bawah itu tetap logo teks. Logo Mega Class Digital hanya disimpan sebagai aset, tidak dipakai (division itu di luar scope MVP).
- Alternatif: memperbesar logo (ditolak, buram) atau membuat ulang logo (ditolak, itu identitas milik owner).
- Biaya membalik: rendah
- Label: REVIEW-OWNER — mohon kirim logo EdukasiAI beresolusi lebih besar atau SVG.

## D-007 — Plugin `error` setelah boot dipulihkan oleh skrip start, bukan oleh core
- Task: G0 (ditemukan smoke test setelah restart L0.4)
- Konteks: setelah restart server, plugin `aao-approval-gate` berstatus `error` (`RPC "initialize" timed out after 15000ms`). Akar masalah terukur: impor dingin `@paperclipai/plugin-sdk` memakan ~7,9 dtk saat mesin diam (1,5 dtk setelah hangat); saat boot server bersamaan dengan Postgres di CPU 2 core, melewati batas 15 dtk milik Paperclip. `plugin enable` saat mesin tenang langsung `ready` (8,6 dtk).
- Pilihan: `scripts/start-paperclip.ps1` memanggil `Repair-Plugins` sesudah server `ok` (dan juga saat server sudah berjalan): plugin berstatus `error` diaktifkan ulang lewat CLI resmi. Batas tunggu boot dinaikkan 5 → 12 menit (terukur 6–8 menit).
- Alternatif: mem-bundle worker dengan esbuild supaya muat lebih cepat (menambah dependency, ditunda); mengubah batas 15 dtk (itu kode core, dilarang).
- Biaya membalik: rendah
- Label: REVIEW-OWNER — setiap restart server memerlukan skrip ini; restart manual lewat cara lain meninggalkan plugin `error` sampai `plugin enable`.

## D-008 — Concern review G0 yang tersisa
- Task: G0
- Konteks: reviewer memberi PASS WITH CONCERNS. Empat rekomendasi FIX diselesaikan inline (lihat `reports/review/G0-review.md`, bagian tanggapan). Yang tersisa:
  1. Agent belum pernah memanggil tool plugin di tengah run; baru dibuktikan di F1.0d dan E1.2.
  2. Baseline hash core dibuat sesudah plugin dipasang, jadi hanya membuktikan "tidak berubah sejak baseline".
  3. `CLAUDE.md` (dilindungi, tidak boleh saya ubah) masih menyebut smoke test "29 cek"; sekarang 37 (38 dengan `--with-core-hash`). Mohon owner memperbarui angka itu.
  4. Subagent reviewer resmi belum terpasang di `.claude/` (O-001); gate memakai agent umum dengan definisi yang sama.
- Pilihan: lanjut ke F1.0a; keempat concern dicatat untuk laporan akhir.
- Biaya membalik: rendah
- Label: REVIEW-OWNER

## D-009 — Situs berita memblokir GET otomatis (AP 403); tidak menyamar sebagai browser
- Task: F1.3
- Konteks: panggilan nyata `verify_candidate` ke artikel AP asli dari keluaran F0.2 dijawab HTTP 403 (proteksi bot). Artikel yang sama dan URL karangan sama-sama 403, jadi cek URL otomatis tidak bisa membedakan keduanya untuk host seperti ini. Semua 6 kandidat F0.2 berasal dari AP.
- Pilihan: tool melaporkan apa adanya (`urlReachable.ok=false`, `error: "HTTP 403"`), tidak memakai User-Agent peniru browser atau cara lain menembus proteksi bot (itu penghindaran deteksi). Kandidat 403 tidak boleh `verified` otomatis; jalurnya `rejected` dengan alasan, atau diteruskan ke manusia. Prioritaskan sumber whitelist (blog resmi) yang umumnya terbuka.
- Dampak: E1.2 mungkin menghasilkan banyak kandidat `rejected` bila Researcher memilih AP. Perlu keputusan owner/reviewer soal kebijakan 403 (mis. status `unverifiable` untuk review manual) sebelum G1.
- Biaya membalik: rendah
- Label: REVIEW-OWNER
