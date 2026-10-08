# DECISIONS — keputusan yang diambil Claude Code tanpa bertanya

Format dan aturan: `loop/LOOP.md` bagian 5. Nomor urut, tidak pernah dihapus; keputusan yang dibatalkan ditandai `DIGANTI oleh D-NNN`.
Label: `AUTO` (mudah dibalik) · `REVIEW-OWNER` (owner perlu melihat di laporan akhir) · `IDEA` (ide di luar scope, tidak dikerjakan).

<!-- Entri pertama dimulai dari D-001 di bawah baris ini. -->

## D-001 — Hapus `"type": "module"` dari package.json root
- Task: persiapan loop (sebelum L0.2)
- Konteks: `scripts/loop-status.js`, `loop/loop-lib.js`, dan hook loop adalah CommonJS dan tidak boleh diubah Claude Code. `package.json` root yang saya buat di F0.7 memuat `"type": "module"` sehingga semua `.js` di repo dianggap ESM dan `node scripts/loop-status.js` gagal (`require is not defined`).
- Pilihan: hapus `"type": "module"`. Semua script kita sudah berekstensi `.mjs` (ESM eksplisit), jadi tidak terpengaruh. Plugin punya `package.json` sendiri dengan `"type": "module"`.
- Alternatif: menaruh `package.json` CommonJS di `scripts/`, `loop/`, `.claude/` (ditolak: `.claude/` terlarang diubah, dan lebih rapuh).
- Biaya membalik: rendah
- Label: AUTO
