# OWNER-QUEUE — hal yang hanya bisa dilakukan owner

Diisi Claude Code. Owner mencentang setelah selesai, lalu mengubah status task terkait di `loop/backlog.json` kembali ke `TODO`
(atau menjalankan `node scripts/loop-status.js --resume` jika loop sudah berhenti).

Format: `- [ ] O-NNN (task <ID>) — <apa yang harus dilakukan, langkah persis> — <dampak jika belum dilakukan>`

<!-- Item pertama dimulai dari O-001 di bawah baris ini. -->

- [x] DIBATALKAN — hook tidak dipakai lagi (revisi 2026-10-08). O-001 (task L0.2) — Pasang hook loop ke `.claude/`: jalankan `powershell -ExecutionPolicy Bypass -File scripts\install-loop-config.ps1` di root repo (sekali). — Tanpa ini hook `Stop` dan reviewer subagent resmi belum aktif; loop tetap berjalan karena logikanya sudah diuji pada salinan (docs/evidence/L0.2). Saya tidak memasangnya sendiri karena skrip itu mengubah izin dan hook agen.
- [ ] O-002 (task L0.5) — Hapus sisa hook lama (penghapusan diblokir pemeriksa izin otomatis meski owner setuju di chat): di root repo jalankan `git rm -r setup/claude scripts/install-loop-config.ps1 scripts/loop.ps1` lalu commit. — Hanya sisa file mati; tidak memblokir task lain.
- [x] SELESAI (owner mengizinkan unduh di chat, 2026-10-08) O-003 (task F1.6a) — Izinkan unduh font Inter (SIL OFL 1.1) ke `divisions/edukasiai/brand/fonts/` beserta `OFL.txt`. Sumber yang saya usulkan: rilis resmi `rsms/inter` di GitHub (paket zip, sekitar 10-20 MB; yang dipakai hanya file woff2 Regular/Medium/SemiBold/Bold) atau `npm i -D @fontsource/inter` (devDependency pinned, sekitar 2 MB woff2). Balas di chat sumber mana yang disetujui, atau taruh file fontnya sendiri di folder itu. — Tanpa font lokal, render tidak identik antar mesin (AC1.5) dan F1.8a, F1.7, F1.9a/b, F1.10, E1.1 dan semua task sesudahnya tidak bisa jalan.
