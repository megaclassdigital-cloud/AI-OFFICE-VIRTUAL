# OWNER-QUEUE — hal yang hanya bisa dilakukan owner

Diisi Claude Code. Owner mencentang setelah selesai, lalu mengubah status task terkait di `loop/backlog.json` kembali ke `TODO`
(atau menjalankan `node scripts/loop-status.js --resume` jika loop sudah berhenti).

Format: `- [ ] O-NNN (task <ID>) — <apa yang harus dilakukan, langkah persis> — <dampak jika belum dilakukan>`

<!-- Item pertama dimulai dari O-001 di bawah baris ini. -->
