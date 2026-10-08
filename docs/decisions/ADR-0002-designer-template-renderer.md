# ADR-0002: Designer berbasis template + renderer deterministik

- Status: Diterima
- Tanggal: 2026-10-04
- Penulis: Claude (chat), atas permintaan owner menambah Designer

## Konteks

Output EdukasiAI harus berupa carousel siap posting, bukan hanya teks. Ada tiga cara membuat gambar slide:

1. LLM menulis HTML/CSS bebas per slide lalu dirender.
2. Model text-to-image membuat gambar.
3. LLM memilih template dan mengisi slot, lalu renderer deterministik membuat PNG.

## Keputusan

Opsi 3. Designer (LLM) menghasilkan `carousel-design.json`: template per slide, isi slot, penekanan, varian warna,
ikon dari set lokal. Renderer (kode) memakai template HTML/CSS brand kit + Playwright/Chromium headless untuk
menghasilkan PNG 1080×1350 dan `contact-sheet.png`, sekaligus menjalankan cek visual otomatis (dimensi, overflow teks
dari DOM, font minimum, kontras ≥ 4,5:1, jumlah file).

## Alternatif yang dipertimbangkan

- Opsi 1 ditolak: hasil tidak konsisten dengan brand, sulit diuji, rawan teks meluber, dan memberi LLM ruang bebas yang tidak perlu.
- Opsi 2 ditolak untuk MVP: teks di gambar sering salah, biaya dan lisensi tidak jelas, dan tidak deterministik.
- Satori + resvg disimpan sebagai cadangan jika Chromium bermasalah di Windows (diuji di F0.7).

## Konsekuensi

- Kualitas visual dibatasi oleh pustaka template. Awalnya 6 template: cover, point, stat, quote, comparison, cta.
- Template baru ditambah berdasarkan data engagement, bukan di awal.
- Approval mengikat hash teks dan semua PNG.

## Cara memverifikasi

AC1.5, AC1.6, AC1.7 dan skenario "Teks meluber", "Template/aset hilang", "Renderer crash" di PRD.
