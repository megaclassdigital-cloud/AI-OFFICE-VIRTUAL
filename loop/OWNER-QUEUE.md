# OWNER-QUEUE — hal yang hanya bisa dilakukan owner

Diisi Claude Code. Owner mencentang setelah selesai, lalu mengubah status task terkait di `loop/backlog.json` kembali ke `TODO`
(atau menjalankan `node scripts/loop-status.js --resume` jika loop sudah berhenti).

Format: `- [ ] O-NNN (task <ID>) — <apa yang harus dilakukan, langkah persis> — <dampak jika belum dilakukan>`

<!-- Item pertama dimulai dari O-001 di bawah baris ini. -->

- [ ] O-001 (task L0.2) — Pasang hook loop ke `.claude/`: jalankan `powershell -ExecutionPolicy Bypass -File scripts\install-loop-config.ps1` di root repo (sekali). — Tanpa ini hook `Stop` dan reviewer subagent resmi belum aktif; loop tetap berjalan karena logikanya sudah diuji pada salinan (docs/evidence/L0.2). Saya tidak memasangnya sendiri karena skrip itu mengubah izin dan hook agen.
