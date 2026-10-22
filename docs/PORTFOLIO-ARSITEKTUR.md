# AI Agent Office — penjelasan arsitektur (bahan portfolio / CV)

Sistem multi-agent yang menjalankan "kantor konten" otonom: dari riset berita AI sampai carousel siap posting di Instagram dan TikTok, dengan manusia (owner) sebagai pemegang keputusan akhir.

## 1. Gambaran satu kalimat
Enam agen LLM berperan sebagai karyawan (Manager, Researcher, Verifier, Copywriter, Designer, QA) yang bekerja berurutan di atas platform orkestrasi Paperclip. Semua keputusan yang butuh kepastian (validasi sumber, render gambar, approval, posting) dipegang **kode deterministik**, bukan LLM. LLM hanya menulis dan menilai; kode yang menjaga gerbang.

## 2. Prinsip desain (yang layak ditonjolkan di CV)
1. **LLM tanpa otoritas final.** Approval, status `approved`, paket publikasi, validasi URL/tanggal, dan render dikerjakan kode. Override owner pun terikat hash hasil QA.
2. **Gambar dibuat renderer deterministik**, bukan LLM. Designer hanya mengisi `carousel-design.json` (JSON) dari template brand kit; tidak menulis HTML/CSS bebas (ADR-0002).
3. **Core tidak di-fork.** Paperclip dipakai apa adanya; semua kustomisasi lewat plugin, skrip, dan template division (ADR-0001). Versi dipin (`docs/versions.md`).
4. **Gerbang berlapis.** Setiap tahap keluarannya divalidasi skema + aturan sebelum lanjut; kegagalan dirutekan balik ke departemen yang tepat (maks N putaran), bukan lolos diam-diam.
5. **Pemulihan mandiri.** Sistem mendeteksi dan memperbaiki kegagalan infrastruktur tanpa operator (retry terbatas, failover model, rekonsiliasi state).
6. **Hemat sumber daya.** Berjalan di laptop 8 GB: pagar RAM, polling adaptif, proses prioritas rendah.
7. **Data keluar dibersihkan.** Monitor publik hanya-baca menerima salinan yang sudah disaring (jalur lokal, id internal, rahasia, kutipan komentar dibuang).

## 3. Stack
| Lapisan | Teknologi |
|---|---|
| Runtime | Node.js 24 (ESM, `.mjs`), PowerShell untuk skrip Windows |
| Orkestrasi agen | Paperclip 2026.1001.0 (open source, MIT), embedded PostgreSQL 18, plugin SDK `@paperclipai/plugin-sdk` |
| Plugin kustom | `aao-approval-gate` (tool: post_comment, set_issue_status, verify_candidate, attach_file, render_carousel, qa_submit_result, handoff_to_owner, dll.) |
| Model LLM | Adapter per agen dengan rantai failover: ChatGPT (Codex OAuth), Claude Sonnet/Haiku (OAuth), Gemini (CLI/ACP), opencode model gratis; konfigurasi di `agent-models.json` |
| Render gambar | Playwright 1.56 + Chromium; template HTML/CSS brand kit; cek visual otomatis (dimensi, ukuran font, kontras, overflow) |
| Ambil gambar sumber | Chrome biasa + CDP (profil terpisah) agar tidak diblokir mesin pencari; capture logo/gambar merek |
| Autoposting | Playwright pada profil browser login Instagram dan TikTok; pemilihan sound TikTok teratas |
| UI | Vanilla JS + Canvas: kantor pixel-art (karakter bergerak sesuai status agen), zoom/pan, mode simulasi/replay, TV status, panel agen, antrean approval |
| Server UI | Node `http` murni (`apps/office-view`): bridge inkremental ke Paperclip, gerbang akses (peran owner / review hanya-baca) |
| Monitor jarak jauh | Vercel (fungsi serverless + Vercel Blob privat), middleware cookie sesi, ingest berbasis rahasia |
| Pengawas | `office-launcher.mjs` + `AIOffice.exe`: menyalakan, menjaga, dan memulihkan seluruh komponen |
| Uji | Vitest, 70 berkas tes (logika murni: routing QA, hash/idempotensi approval, validasi skema, gerbang, pemulihan, pemantau) |
| Repo | ±185 commit, ADR di `docs/decisions/`, loop engineering (`loop/`) |

## 4. Arsitektur komponen
```
Owner ── UI desktop (Office View, 127.0.0.1:3190) ──┐
                                                    │ baca/menulis lewat bridge
Pengawas (office-launcher) ── menjaga ──► Paperclip (3177, Postgres tertanam, plugin approval-gate)
        │                                    ▲  ▲
        ├─► Orkestrator (state machine job) ─┘  │  issue = tahap, agen = pekerja
        ├─► Failover model (ganti model saat kuota/auth gagal)
        ├─► Admin Publikasi (autopost IG + TikTok)
        └─► Publisher monitor ──POST──► Vercel (ingest → Blob → data API) ◄── browser (hanya-baca)
```
- **Paperclip**: sistem tiket. Setiap tahap produksi = satu issue yang ditugaskan ke agen; agen berkomentar/menutup lewat tool plugin.
- **Orkestrator** (`scripts/orchestrator.mjs`, `orchestrator-core.mjs`): mesin status deterministik. `step(job, facts)` fungsi murni menentukan aksi (createStage, retryStage, block, finish); I/O dipisah supaya bisa dites.
- **Plugin approval-gate**: satu-satunya jalur agen mengubah status/komentar; menegakkan transisi yang boleh (done/cancelled hanya owner).
- **Failover** (`manager-failover.mjs`): berpindah model hanya saat agen tidak sibuk dan run gagal karena kuota/auth; kembali ke prioritas utama tiap hari baru WIB.

## 5. Alur produksi (end-to-end)
1. **Brief masuk** dari owner (inbox/chat) atau dari **kantor otonom** (lihat §7).
2. **Manager** menyusun *work order* (JSON: judul, instruksi per tahap). Divalidasi skema; bila rusak, Manager diminta memperbaiki.
3. **Researcher** mencari kandidat berita → `research-output.json`.
4. **Verifier** memeriksa tiap kandidat: tool `verify_candidate` (kode) memeriksa URL terbuka dan tanggal terbit dalam jendela hari; LLM hanya menilai apakah klaim ada di halaman. Terlalu sedikit yang valid → balik ke Researcher (maks putaran).
5. **Copywriter** menulis `carousel.json` (slide, caption, hashtag) berbasis sumber terverifikasi.
6. **Designer** mengisi `carousel-design.json`: pilih template, slot, kebutuhan gambar. Gerbang aset mengambil gambar asli (capture dari sumber/merek); tanpa gambar asli produksi **ditahan**, tidak diganti gambar palsu.
7. **Render** deterministik → PNG per slide + contact sheet + segel hash.
8. **QA**: cek deterministik (dimensi, font minimal, kontras, overflow, aset, tanggal, URL) + penilaian LLM (teks/desain). Penolakan dirutekan ke Copywriter/Designer/Researcher dengan catatan (maks putaran); lewat batas → butuh keputusan owner.
9. **Finalisasi** (`finalize-production.mjs`, kode): lampirkan dokumen ke satu issue produksi, catat verifikasi, segel render, kirim hasil QA, `handoff_to_owner`.
10. **Owner approval** di UI. Hanya yang disetujui masuk antrean posting.
11. **Admin Publikasi** memposting ke Instagram dan TikTok (jeda antar posting, pagar harian, bukti screenshot), lalu status **LIVE** tampil di kantor.

## 6. Output tiap tahap
| Tahap | Berkas / output |
|---|---|
| Manager | work order JSON (skema divalidasi) |
| Researcher | `research-output.json` (kandidat + tanggal + URL) |
| Verifier | `verification-result.json` + catatan `verify_candidate` di issue |
| Copywriter | `carousel.json` (slide, caption, hashtag, sumber) |
| Designer | `carousel-design.json` + `assets-manifest.json` + aset gambar |
| Render | `render/slide-NN.png`, contact sheet, segel SHA-256 |
| QA | `qa-result.json` (llmReview, designReview, returnTo, notes) |
| Finalisasi | dokumen pada issue produksi + paket publikasi + status menunggu approval |
| Posting | posting live IG/TikTok + bukti + log autopost |

## 7. Kantor otonom
Saat tidak ada pekerjaan, Manager berinisiatif membuat brief baru: membaca analitik audiens (TikTok Studio) untuk topik berkinerja baik, lalu menulis brief ke inbox. Pagar: maks 3 brief/hari, jeda 2 jam, maks 2 menunggu owner, jam tenang 00–05 WIB, pemutus (2 gagal → henti 6 jam), tahan saat RAM rendah. Konten otomatis yang berhenti di QA diserahkan ke antrean approval, bukan diposting.

## 8. Ketahanan dan pemulihan mandiri
- Heartbeat tiap komponen; pengawas memulai ulang yang mati/macet, mendeteksi laptop tidur/offline dan membekukan jam tahap.
- `sustain-core.mjs` (murni, dites): retry tahap gagal karena infrastruktur (maks 2x), penilaian ulang blokir gerbang, penyembuhan agen berstatus error, rekonsiliasi job "terblokir" yang sebenarnya sudah diserahkan ke owner, pembuatan ulang issue tahap yang hilang.
- Perbaikan mekanis di gerbang: rapikan salah ketik nama slot, buang catatan aset basi, jendela tanggal dihitung sejak verifikasi.
- Antrean perintah (`workspace/commands/`) menghindari balapan state antara CLI dan orkestrator.

## 9. Monitor kedua di Vercel (hanya-baca)
Laptop tidak menerima koneksi masuk. Publisher hanya GET ke UI lokal dan POST keluar ke `/api/ingest` (rahasia). Data disaring (`scrub.mjs`), disimpan di Vercel Blob privat, disajikan fungsi serverless di balik cookie sesi. Mengikuti insiden kuota Blob, publisher kini **tidur tanpa pengunjung**, menggabung dokumen panas jadi satu unggahan, punya batas tulis bulanan, dan fungsi men-cache di memori.

## 10. Keamanan
Tidak ada secret di repo (`.env`, workspace, output di-gitignore); mode review hanya-baca dengan audit kebocoran; pembatas laju percobaan kunci; penyaring jalur lokal/UUID/token/surel; perintah (chat Manager, keputusan) tidak tersedia di monitor publik.

## 11. Metodologi pengembangan
*Loop engineering*: backlog + definition of done per task, ADR untuk keputusan arsitektur, test-first untuk logika deterministik, bukti perilaku (bukan "seharusnya jalan"), jurnal dan laporan build per task. Tim: owner (produk/keputusan) + Claude Code sebagai implementation engineer.

## 12. Hasil yang sudah terbukti
Konten nyata terbit LIVE di Instagram dan TikTok (mis. EDU-97) lewat pipeline penuh; ribuan baris logika murni dengan 70 berkas tes; pemulihan mandiri teruji pada kegagalan nyata (plugin timeout, kuota model, Paperclip putus, produksi tertunda berhari-hari).

## 13. Keterbatasan jujur (baik disebut saat interview)
- Berjalan di satu laptop 8 GB; bukan sistem multi-tenant/terdistribusi.
- Kuota model gratis membatasi throughput; failover mengurangi tapi tidak menghapus risiko.
- Monitor Vercel dibatasi kuota Blob paket Hobby; mode owner di perangkat lain belum dibuat.
- Mutu konten bergantung LLM; QA dan gerbang menahan yang buruk tetapi keputusan akhir tetap manusia.
