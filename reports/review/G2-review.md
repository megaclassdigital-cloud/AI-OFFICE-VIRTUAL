# G2 — Review gate Fase 2 (reviewer subagent, 2026-10-08)

**VERDICT: PASS WITH CONCERNS.** Batas FAIL: FIX-G2-01, -02, -03, -05 wajib selesai sebelum E1.2 (run agent LLM nyata). Saat ini tidak ada agent nyata yang berjalan, jadi belum FAIL.

Diverifikasi reviewer sendiri: `npx vitest run` 24 file / 318 tes lulus; `loop-status --check` valid; tidak ada git remote/push; tidak ada secret; tidak ada perubahan kode Paperclip; `.env` dan `output/` di `.gitignore`; `.env` (token owner) belum dibuat.

## Yang berjalan baik
- FIX-G1-01/02/03/06 menutup mekanisme yang ditunjuk G1 (catatan verify dan segel render di state plugin; hash PNG dihitung ulang; research-output wajib).
- Plugin tidak punya tool approve/reject/publish/token dan tidak mengimpor owner-approval.
- Record approval: skema, append-only `wx`, `timingSafeEqual`. prepare_publication: AC2.1-2.3 diuji dengan render golden nyata, tulis ke tmp lalu rename. owner-decide: record dulu, reject wajib catatan. Routine nonaktif default, tanpa panggilan /run. KPI jujur menulis "BELUM ADA DATA".

## Temuan (FIX-G2-NN)
| Fix | Masalah | Syarat |
| --- | --- | --- |
| FIX-G2-01 | Otoritas approval hanya pemisahan file + token `.env`; berkas valid skema dengan `decided_by:"owner"` diterima `readDecisions` (dibuktikan reviewer). Agent codex_local dengan shell yang bisa menulis `output/approvals`, membaca `.env`, atau menjalankan `owner-decide` dapat memalsukan approval. Sandbox adapter belum didokumentasikan/diuji | sebelum E1.2 |
| FIX-G2-02 | `decide approve` menghitung hash saat approve, tidak dibandingkan dengan dokumen `handoff`; issue bisa masuk in_review tanpa QA (via complete_stage, G1-05 terbuka) lalu di-approve; `--render-dir` bebas | sebelum E1.2 |
| FIX-G2-03 | `preparePublication` tidak memeriksa status issue; kegagalan API di tengah `decide` tidak diuji; retry membuat record kedua | sebelum E1.2 |
| FIX-G2-04 | TOCTOU: PNG di-hash lalu disalin tanpa hash ulang; tanpa lock, dua proses paralel bisa membuat dua folder | sebelum Fase 3 |
| FIX-G2-05 | Segel render: design dibaca ulang dari disk setelah render; hashes dari disk | sebelum E1.2 |
| FIX-G2-06 | `published_at` dan `research-output` adalah masukan agent; "akurasi sumber 100%" belum boleh diklaim; perlu keputusan owner (tanggal dari fetch halaman) | sebelum Fase 3 |
| FIX-G2-07 | KPI: label fixture vs agent di file KPI, biaya "tidak terukur" selama billed_cents 0, biaya per minggu dan per event test-harness (D-006), "draf" dari segel plugin, pindai `output/edukasiai/` untuk paket tanpa audit | rendah |
| FIX-G2-08 | README/package.json plugin menyebut "tool prepare_publication" (tidak ada); routine belum diuji di Paperclip nyata (O-005) | rendah |

Tersisa dari G1: FIX-G1-04, -05, -07, -10 (sebelum E1.2), -08 (sebelum division kedua), -09.
**Jangan dibangun dulu:** E1.2 dan routine aktif sampai G2-01/02/03/05 dan G1-04/05/07/10 selesai; tombol approve di Console (O-005) sampai G2-01 selesai; division kedua sampai G1-08.

## Tanggapan implementer
Semua temuan diterima. Tidak ada yang ditolak. Rencana: G2-01, -02, -03, -05 dikerjakan sekarang (sebelum Fase 3) karena menyangkut otoritas approval; G2-04, -07, -08 sebelum G3; G2-06 menunggu keputusan owner (O-006).
