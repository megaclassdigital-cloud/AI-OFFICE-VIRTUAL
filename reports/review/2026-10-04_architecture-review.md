# Review: Pemilihan core dan PRD awal

- Tanggal: 2026-10-04
- Reviewer: Claude (chat)
- Yang direview: pilihan repo open source, PRD v1

VERDICT: PASS WITH CONCERNS

## WHAT WORKS

- Paperclip menutup sebagian besar kebutuhan core (division = company, agent, issue, budget, audit, plugin SDK). Lisensi MIT dan sangat aktif.
- Desain approval terikat hash dan renderer deterministik menjaga LLM agar tidak memegang otoritas publikasi.

## WHAT IS WRONG

- Belum ada bukti Paperclip berjalan di Windows owner. Semua klaim kemampuan berasal dari README dan struktur kode, belum dari uji perilaku.

## RISK

- Fork drift jika ada yang tergoda mengubah core.
- Agent CLI punya akses shell luas.
- Model gratis mungkin terlalu lemah untuk copywriting dan pemilihan template.
- `npx` tidak dikenali di PATH pada aplikasi desktop owner (4 Okt 2026).

## MISSING TEST

- Semua AC Fase 0 belum dijalankan.

## REGRESSION RISK

- Belum ada kode. Risiko muncul saat upgrade Paperclip, jadi versi harus dipin sejak F0.1.

## RECOMMENDED FIX

- Jalankan Fase 0 sesuai urutan di STATUS.md sebelum menulis kode division.

## DO NOT BUILD YET

- Pixel Agents, WhatsApp, Provider Resolver custom, MegaClassDigital, posting otomatis, gambar generatif.
