# DEFAULTS — jawaban sementara untuk pertanyaan yang belum dijawab owner

Claude Code memakai nilai di sini **tanpa bertanya**. Owner boleh mengubah file ini kapan saja; perubahan berlaku untuk task berikutnya.
Setiap pemakaian default yang berdampak pada desain dicatat di `DECISIONS.md` dengan label `REVIEW-OWNER`.
Disusun 2026-10-08 dari PRD bagian 8 dan pertanyaan terbuka di STATUS.md 2026-10-05.

## Produk dan konten

| Pertanyaan | Default | Biaya membalik |
| --- | --- | --- |
| Platform target carousel | Instagram, rasio 4:5, kanvas 1080×1350 px, 6–10 slide | Rendah (`brand.json`) |
| Audiens | Pemula–menengah: profesional dan mahasiswa Indonesia yang tertarik AI. Istilah teknis dijelaskan singkat. | Rendah |
| Sumber berita | Prioritas: blog resmi OpenAI, Anthropic, Google DeepMind/Google AI, Meta AI, Microsoft AI, Hugging Face; media: The Verge, TechCrunch, Ars Technica, VentureBeat. Sumber lain boleh jika lolos Verifier dan ditandai `non_whitelist: true`. | Rendah (konfigurasi) |
| Bahasa konten | Bahasa Indonesia baku yang santai; istilah AI populer boleh tetap Inggris dengan penjelasan | Rendah |
| Hashtag | 5–8 per caption, campuran Indonesia dan Inggris | Rendah |
| Brand kit | Pakai `brand.json` yang sudah ada (status sementara). Font: **Inter** (OFL), dipaketkan lokal. Logo teks "EdukasiAI". | Rendah |

## Model dan biaya

| Pertanyaan | Default | Biaya membalik |
| --- | --- | --- |
| Adapter agent | `codex_local` (satu-satunya yang lolos di mesin owner). Jangan memasang CLI atau provider baru. | Sedang |
| API berbayar | **Tidak.** Tidak ada API key berbayar baru. | — |
| Kuota langganan | Run agent nyata hanya di E1.2 dan H3.1 (lihat BACKLOG "Prinsip hemat kuota"). Semua yang lain memakai fixture. | — |
| Batas pemakaian (F1.0f) | 6 run per agent per hari, 60 menit total durasi per agent per hari | Rendah (`limits.json`) |

## Keputusan operasional (dari STATUS 2026-10-05)

| Pertanyaan | Default | Biaya membalik |
| --- | --- | --- |
| `git init` | **Ya**, di L0.1. Lokal saja, tanpa remote. | Rendah |
| Company `Office Mega Class` | Biarkan, jangan dibaca, diubah, atau dihapus. Bukan buatan loop. | — |
| Telemetry Paperclip | Matikan lewat konfigurasi (data keluar mesin, isinya belum diperiksa) | Rendah |
| Ledger uji 250 sen dari AC0.5 | Jangan reset database. Catat ID cost-event uji dan kecualikan di laporan KPI. | Rendah |
| Auto-start server | Tidak. Start manual dengan `scripts/start-paperclip.ps1`, didokumentasikan di RUNBOOK. | Rendah |
| Routine harian | Dibuat **nonaktif**; owner mengaktifkan saat burn-in | Rendah |
| Jam routine | Senin–Jumat 07.00 WIB (Asia/Jakarta) | Rendah |

## Teknis

| Pertanyaan | Default | Biaya membalik |
| --- | --- | --- |
| Bahasa kode | JavaScript ESM (`.mjs`) + JSDoc, mengikuti kode yang sudah ada. Tidak migrasi ke TypeScript. | Tinggi, jangan diubah tanpa ADR |
| Test runner | vitest | Rendah |
| Validator skema | ajv (draft 2020-12) | Rendah |
| HTTP dari script | Node `fetch` dengan `Buffer.byteLength`. **Jangan** `Invoke-RestMethod` untuk body non-ASCII. | — |
| Penyimpanan approval record | File JSON append-only di folder data plugin, satu file per record, ber-`schema_version` | Sedang |
| Identitas owner untuk approve | Token owner lokal di `.env` (`AAO_OWNER_TOKEN`), dibuat script setup; agent tidak pernah menerimanya | Sedang |
| Renderer | Playwright 1.56.0 + Chromium 1194 (dipin); cadangan Satori + resvg (ADR-0002) | Sedang |
| Port Paperclip | 3177 (3100 milik ERP-KIOS owner) | — |
