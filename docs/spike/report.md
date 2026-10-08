# Laporan Spike Fase 0 — Kelayakan Paperclip sebagai core AI Agent Office

- Tanggal: 2026-10-05
- Penulis: Claude Code (Opus 5)
- Lingkungan: Windows 10 Home 19045, Intel Core i3-7020U (2 core), Node 24.19.0, Paperclip 2026.1001.0

## Rekomendasi

**LANJUT.** Kelima acceptance criteria Fase 0 lolos dengan bukti perilaku nyata, bukan klaim. Paperclip terbukti bisa dipakai sebagai core tanpa diubah sedikit pun.

Tetapi lanjut **dengan tiga syarat** yang harus diselesaikan sebelum Fase 1 dianggap aman, lihat bagian "Yang harus dibereskan sebelum Fase 1".

## Hasil per kriteria

| AC | Kriteria | Hasil | Bukti |
| --- | --- | --- | --- |
| AC0.1 | Paperclip berjalan di Windows owner | **PASS** | `/api/health` HTTP 200 `status=ok`, `bootstrapStatus=ready`, 282 migrasi diterapkan, UI React tersaji, screenshot |
| AC0.2 | 1 run agent selesai, biaya tercatat USD 0 | **PASS** | Run `succeeded` exit 0 dalam 3m18s; `costCents=0`, `apiRunCount=0`, `subscriptionRunCount=1` |
| AC0.3 | Isolasi company terbukti | **PASS** | 5 endpoint lintas company ditolak HTTP 403; kontrol company sendiri 200; tidak ada data terbentuk |
| AC0.4 | Plugin menambah tool tanpa mengubah core | **PASS** | Tool dieksekusi HTTP 200; hash manifest core identik sebelum/sesudah |
| AC0.5 | Budget habis membuat agent berhenti | **PASS** | Status agent `idle` → `paused`, policy `hard_stop`, `pauseReason=budget` |
| F0.7 | Render PNG 1080×1350 di Windows | **PASS** | Dimensi tepat dari header PNG; dua render byte-identik (SHA-256 sama) |

Laporan rinci: `reports/build/2026-10-04_F0.1.md`, `2026-10-04_F0.2.md`, `2026-10-05_F0.2-fix-loop.md`, `2026-10-05_F0.3-F0.5.md`, `2026-10-05_F0.7.md`.

## Angka yang perlu diingat

| Hal | Angka |
| --- | --- |
| Waktu run agent (riset 6 kandidat berita) | 3 menit 18 detik |
| Token satu run | 1.489 input, 124 output, 57.088 cached |
| Biaya marginal | USD 0 (`subscription_included`) |
| Launch Chromium | 389 ms |
| Render 1 slide PNG 1080×1350 | ~550–600 ms |
| Ukuran PNG | 523 KB |
| Ukuran instalasi browser Playwright | 550,1 MB |
| Ukuran data Paperclip (termasuk Postgres) | ~80 MB |

Mesin owner lambat tetapi memadai. Estimasi kasar satu carousel 8 slide: render ~5 detik, jauh lebih murah daripada tahap LLM.

## Masalah Windows yang ditemukan

Enam masalah nyata, semuanya sudah dipecahkan dan didokumentasikan.

1. **Node belum terpasang sama sekali.** STATUS.md menduga masalah PATH; ternyata Node memang tidak ada. Dipasang Node LTS 24.19.0.

2. **Embedded PostgreSQL 18 crash `0xC0000005`.** Instalasi gagal total dengan pesan menyesatkan ("The data directory might already exist"). Akar masalah: VC++ Redistributable sistem masih 14.23 (2019), sedangkan PostgreSQL 18 butuh ≥ 14.40. Dibuktikan dengan menjalankan `initdb` langsung di luar Paperclip sebelum dan sesudah upgrade. **Prasyarat ini tidak didokumentasikan Paperclip.**

3. **Bentrokan port 3100 yang tidak terdeteksi.** ERP-KIOS milik owner mengikat IPv6 `::`, Paperclip mengikat IPv4 `127.0.0.1`, sehingga keduanya hidup bersamaan dan `doctor` tetap melaporkan "Port 3100 is available". Tetapi `localhost` di Windows diselesaikan ke `::1` lebih dulu, sehingga CLI Paperclip **berbicara ke aplikasi kasir owner**. Paperclip dipindah ke port **3177**.

4. **PowerShell `Invoke-RestMethod` menggantung selamanya** untuk body JSON panjang yang mengandung karakter non-ASCII (teks Indonesia dengan `≥`, `—`, `×`). Content-Length dihitung dari jumlah karakter, bukan byte UTF-8, sehingga server menunggu sisa data yang tidak pernah datang. `-TimeoutSec` tidak menolong dan request tidak pernah tercatat di log server. Semua script kita dipindah ke Node.

5. **`runWorker()` dari SDK resmi tidak berfungsi di Windows ini.** Deteksi main-module (`realpath(import.meta.url)` vs `realpath(process.argv[1])`) gagal, sehingga worker plugin hidup tetapi diam, lalu dibunuh setelah 15 detik tanpa satu baris stderr. Solusi: pola bootstrap `startWorkerRpcHost({ plugin })` yang disebut README SDK.

6. **Paperclip tidak mendukung Windows service.** `doctor`: "Service management is not supported on win32". Server harus dijalankan sebagai proses biasa dan tidak auto-start setelah reboot. Dimitigasi dengan `scripts/start-paperclip.ps1` yang menjalankannya detached.

## Masalah perilaku agent

**Loop 1412 perintah.** Pada run pertama, Researcher mengulang perintah PowerShell yang identik **1412 kali** untuk mengirim satu komentar yang sebenarnya sudah berhasil terkirim sejak percobaan pertama. Penyebabnya masalah nomor 4 di atas: perintah menggantung, agent mengira gagal, lalu mencoba lagi tanpa batas. Tidak ada batas waktu sama sekali di adapter.

Diperbaiki dua lapis:
- **Deterministik:** `adapterConfig.timeoutSec = 600` dan `nonInteractivePermissions = deny`.
- **Instruksi:** protokol anti-loop di `divisions/edukasiai/sop/agent-protocol.md`, disisipkan otomatis ke kelima agent.

Hasil run sesudah perbaikan: **135 tool call** (turun 90%), komentar tepat satu kali.

## Temuan yang mengubah asumsi PRD

### 1. Tidak ada adapter gratis yang tersedia

PRD mengutamakan `gemini_local`, `opencode_local`, atau `pi_local`. **Ketiganya gagal** `test-environment` karena CLI-nya tidak terpasang di mesin ini. Satu-satunya yang lolos adalah `codex_local`, yang memakai langganan Codex owner.

Konsekuensinya biaya API memang USD 0, tetapi "gratis" di sini berarti "sudah dibayar lewat langganan", bukan free tier. Pemakaian membebani kuota langganan owner dan bisa kena rate limit yang tidak terlihat oleh Paperclip.

### 2. Budget guard tidak akan pernah menyala

Ini konsekuensi lanjutan dari nomor 1, dan **yang paling penting dari seluruh spike**.

Metrik budget Paperclip adalah `billed_cents`. Run dengan adapter langganan tercatat `costStatus: unpriced`, `costCents: 0`. Artinya berapa pun banyaknya run, `observedAmount` tetap 0 dan hard stop **tidak akan pernah terpicu**.

AC0.5 lolos hanya karena biaya disuntikkan lewat API `cost-events`. Mekanismenya benar; yang tidak ada adalah data biaya untuk memicunya.

KPI PRD "biaya ≤ USD 5/bulan" secara teknis selalu terpenuhi, tetapi tidak memberi perlindungan apa pun. Kalau perlindungan nyata dibutuhkan, batasnya harus pada jumlah run, durasi, atau token — bukan `billed_cents`.

### 3. Plugin adalah kode tepercaya, bukan sandbox

README SDK menyatakan plugin worker dan UI harus diperlakukan sebagai kode tepercaya, dan UI plugin berjalan same-origin sehingga capability di manifest **bukan sandbox frontend**. Ini relevan untuk gate approval di Fase 2: keamanan approval tidak boleh bergantung pada capability plugin.

## Yang harus dibereskan sebelum Fase 1

1. **Pindahkan komunikasi agent ke tool deterministik.** Loop terjadi karena agent menyusun sendiri perintah HTTP PowerShell. Perbaikan sekarang sebagian bergantung pada kepatuhan LLM terhadap instruksi. Perbaikan yang benar-benar tahan: tool komentar/status di plugin `aao-approval-gate`, sehingga agent tidak pernah menyusun HTTP sendiri.

2. **Tentukan siapa yang menutup issue.** EDU-2 tetap `in_progress` setelah agent selesai, dan Paperclip memunculkan "needs a disposition" yang memicu heartbeat baru terus-menerus. Ini pengulangan di tingkat orkestrasi dan belum terpecahkan.

3. **Ganti dasar perlindungan biaya.** Lihat temuan nomor 2 di atas.

## Utang teknis yang tercatat

| Hal | Dampak | Catatan |
| --- | --- | --- |
| Repo belum di bawah git | Tidak ada jaring pengaman padahal kode sudah ada | Menunggu keputusan owner |
| Ledger biaya tercemar 250 sen data uji | KPI biaya salah baca | Dari uji AC0.5; harus diabaikan atau DB direset |
| Instalasi lewat cache `npx` | CLI sendiri memperingatkan ini sementara | Sebaiknya pindah ke `paperclipai install` dengan versi dipin |
| `telemetry.enabled: true` bawaan | Data keluar mesin, isinya belum diperiksa | Menunggu keputusan owner |
| Izin `master.key` 666 | Saran doctor `chmod 600` tidak berlaku di Windows | Perlu padanan ACL (`icacls`) |
| Company `Office Mega Class` bukan buatan Claude Code | Instance tidak bersih | Menunggu keputusan owner |
| Verifier dan QA sama-sama `role=qa` | Org chart terlihat punya dua QA | Enum Paperclip tidak punya "verifier" |
| Folder instruksi agent terhapus tidak dibersihkan | Sampah data | Bug kecil Paperclip |

## Kesimpulan

ADR-0001 (Paperclip sebagai core, tanpa fork) **terbukti layak**. Tidak satu byte pun core berubah selama seluruh Fase 0, dan semua perluasan berhasil lewat titik ekstensi resmi: plugin SDK, adapter, konfigurasi company, dan API.

Risiko terbesar bukan pada Paperclip, melainkan pada **ketiadaan model gratis yang berfungsi** dan **hilangnya perlindungan biaya** sebagai akibatnya. Keduanya perlu keputusan owner sebelum Fase 1 berjalan dengan volume produksi.
