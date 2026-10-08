# G3 — Review gate Fase 3 (reviewer subagent, 2026-10-09)

**VERDICT: PASS WITH CONCERNS.** Proyek layak masuk X.FINAL sebagai laporan akhir yang jujur, bukan sebagai klaim "MVP terbukti". Reviewer memberi syarat: laporan akhir harus menyebut yang belum terbukti, dan angka tes harus dari run bersih pada mesin tidak sibuk.

## Yang diverifikasi reviewer
- `npx vitest run` pada kondisi proyek saat review: 412 tes. Pada run reviewer, 3 file gagal karena timeout 120 dtk pada tes Chromium; penyebabnya lingkungan (lihat catatan implementer). `loop-status --check` valid 68 task; `secret-scan` 347 berkas, 47 commit, 0 temuan.
- Tidak ada git remote/push, tidak ada perubahan kode Paperclip, file terlarang tidak berubah oleh implementer. ACL `master.key` cocok dengan klaim H3.2 (klaim jujur: tidak ada sandbox OS yang terbukti).
- Percobaan mematahkan yang bertahan: HMAC record tanpa/palsu/diubah, `decide` (status, handoff, hash, render-dir turunan), `preparePublication` (done, hash, kunci, hash ulang salinan), gerbang peran (gagal tertutup, terikat companyId, `attach_file` menolak `handoff`), SSRF (userinfo, desimal/hex/oktal, IPv4-mapped, NAT64, 6to4, zone id, DNS menahan `localhost.`).
- RUNBOOK: semua perintah yang diperiksa ada; penanda [teruji]/[belum teruji] konsisten bukti. U4.0 SKIPPED dan U4.5 BLOCKED jujur; ACU.4 read-only didukung kode.

## Temuan dan tanggapan implementer
| Fix | Masalah | Tindakan |
| --- | --- | --- |
| FIX-G3-01 | `readDecisions` mengurutkan menurut NAMA berkas; replay record approved lama dengan nama `zzz.json` membalik keputusan terakhir (didemonstrasikan reviewer) | **Selesai**: urut menurut `decided_at` bertanda tangan (tie-break `record_id`); nama berkas harus = stempel waktu + `record_id`; 3 tes baru (salin, ganti nama, tie-break) |
| FIX-G3-02 | `tool-roles.json` di dalam repo, bisa diedit agent bila sandbox bocor; plugin live belum di-reload | **Terbuka**, digabung dengan FIX-G2-01b (sebelum E1.2) |
| FIX-G3-03 | `contact-sheet.png` (yang dilihat owner) tidak terikat hash paket | **Selesai**: `decide` memverifikasi sha256 contact sheet terhadap catatan handoff; 2 tes baru |
| FIX-G3-04 | `localhost.`/`foo.localhost.` lolos `policyViolation`; IPv6 SIIT/Teredo/site-local/NAT64 lokal/discard lolos | **Selesai**: titik akhir dibuang, rentang ditambah; 2 tes baru. Pinning IP DNS tetap backlog |
| FIX-G3-05 | `HANDOFF_HASH_RE` tak berjangkar; topik dengan newline dapat menyuntikkan baris hash palsu | **Selesai**: regex berjangkar per baris + semua kecocokan harus satu nilai (dua nilai berbeda = ditolak); 2 tes baru |
| FIX-G3-06 | U4.3 DONE melebihi DoD; ADR-0003 usang; judul FIX-G1-05 | **Selesai (catatan)**: D-016. ADR-0003 adalah berkas owner yang belum di-commit, tidak diubah implementer; owner diminta mengubah statusnya (REVIEW-OWNER) |
| FIX-G3-07 | label H3.1 terlalu murah; timeout Chromium 120 dtk rapuh | **Selesai**: label skenario 2/5/10/12-13 dikoreksi; timeout 300 dtk; RUNBOOK §10b |

## Sebab run tes reviewer tidak bersih (diselidiki implementer)
Proses `find.exe` (PID 3484, `find / -maxdepth 6 ... paperclipai ... server`, ±4800 dtk CPU) yang menyedot CPU ternyata sisa perintah pencarian implementer sendiri dari awal sesi (terverifikasi lewat command line dan waktu mulai); bukan milik ERP-KIOS/JARVIS/Paperclip. Dihentikan berdasarkan PID. Pelajaran: perintah pencarian rekursif dari `/` jangan dijalankan di Windows.

## Bukti setelah perbaikan
`docs/evidence/G3/npm-test.txt`: 27 file, **421 tes lulus**, exit 0 (456 dtk; CPU masih ramai oleh proses lain tetapi timeout baru cukup). Angka ini belum dari mesin yang sepenuhnya idle; owner diminta menjalankan ulang `npm test` sebelum menjadikannya acuan.

## Belum diperiksa reviewer / belum terbukti
Run penuh di mesin idle; `owner-decide`/`prepare-publication` terhadap Paperclip nyata; gerbang peran pada plugin live (belum di-reload); sandbox codex_local; isi tiga berkas tes baru.

## Jangan dibangun dulu (dari reviewer)
Tombol approve di Console (sebelum FIX-G2-01b dan G3-02); routine aktif/burn-in (sebelum E1.2 lulus dan FIX-G1-07/10); orkestrasi antar-agent otomatis; G4/U4.5 (sebelum rekaman event nyata, ACU.2); upgrade Paperclip atau pinning IP sebagai pekerjaan sampingan.
