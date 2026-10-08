# FIX-G2-04 (mencakup G2-04, G2-07, G2-08)

Tanggal 2026-10-09.

## G2-04 — TOCTOU dan paralel `prepare_publication`
- Kunci per issue (`mkdir` atomik `.lock-<issueId>` di folder output): proses lain yang sedang menyiapkan membuat panggilan kedua ditolak (`publish_refused_busy`, tercatat); kunci basi (>5 menit, proses mati) diambil alih; kunci selalu dilepas di `finally`.
- PNG disalin ke folder sementara lalu **salinannya di-hash ulang** dan harus sama dengan hash yang disetujui sebelum `rename`; bila beda, paket dibatalkan (`publish_refused_changed_during_copy`).
- Tes: PNG ditukar saat disalin (parameter `copyFile` untuk injeksi) ditolak tanpa folder paket lalu percobaan bersih berhasil; kunci aktif/basi/dilepas; **tiga proses Node paralel pada approval yang sama menghasilkan tepat satu folder** (proses lain ditolak "sedang menyiapkan").

## G2-07 — KPI jujur
Issue berjudul fixture/e2e/uji/test ditandai "(fixture)"; bila semua draf fixture, status KPI berbasis draf diberi label "DATA FIXTURE, bukan kinerja agent". Biaya: bila ada run tetapi biaya 0, status "TIDAK TERUKUR" (bukan TERCAPAI) dan angka diberi label KUMULATIF (sumber Paperclip tidak per minggu). `kpi-2026-W41.md` dibuat ulang dengan label ini.
Belum: biaya per event `biller=test-harness` (D-006) dan pemindaian `output/edukasiai/` untuk paket tanpa audit; dicatat sebagai sisa kecil.

## G2-08 — Klaim vs bukti
README dan `package.json` plugin tidak lagi menyebut tool `prepare_publication` (sengaja bukan tool agent). Routine tetap belum diuji di Paperclip nyata (O-005).

## Bukti
Suite penuh 26 file, 363 tes lulus.
