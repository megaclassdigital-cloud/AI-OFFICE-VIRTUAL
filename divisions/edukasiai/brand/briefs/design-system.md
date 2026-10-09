---
judul: Master Design System edukasiai.co.id (brief tetap dari owner)
colorVariant: editorial
templateHint:
  hook: cover
  point: point
  stat: stat
  quote: quote
  comparison: comparison
  cta: cta
emphasis: satu kata atau frasa kunci per slide, diberi warna aksen
---

# Brief tetap Designer — edukasiai.co.id

Sumber: Master Design System dari owner (2026-10-09). Brief ini berlaku untuk **setiap** produksi; brief topik hanya mengubah
isi, kategori, dan aksen. Brand kit v2 di `D:\AI-Memory\AI-Agent-Office\divisions\edukasiai\brand\` sudah menerapkan font, warna, footer,
dan margin; kamu memilih template, varian warna, penekanan, dan ikon.

## Identitas

Dark futuristic editorial: profesional, minimalis, berani, sedikit dramatis, cerdas, mudah dibaca. Terasa seperti media teknologi
serius, **bukan poster promosi produk AI**. Kanvas portrait 4:5 (1080 x 1350).

## Aturan wajib (tetap untuk semua topik)

1. Background hitam/charcoal dengan gradient gelap halus (sudah di varian `editorial`, `risiko`, `teknologi`).
2. Font Poppins; headline Bold/ExtraBold, dominan putih; **satu** kata/frasa kunci diberi warna aksen (`emphasis`).
3. Label kategori kecil, uppercase, **kuning** (slot `kicker`), mis. `AI LAW`, `AI SECURITY`, `AI ECONOMY`, `AI MODEL`.
4. `edukasiai.co.id` kecil di footer, posisi konsisten (renderer yang menempatkannya). Sumber ditulis kecil tapi terbaca.
5. **Dilarang** nomor halaman (`1/6`), ornamen berlebihan, kolase, teks terlalu padat.
6. Margin kiri-kanan konsisten; teks utama tidak dekat tepi; footer tidak dipindah.
7. Bahasa Indonesia ringkas, profesional, nuansa high-tech. Headline boleh tajam, tetapi isi akurat dan berimbang:
   hindari klaim absolut, ketakutan berlebihan, dan rumor yang ditulis seolah terbukti.
8. Semua klaim harus bersumber dan dapat diverifikasi; fakta slide (angka, nama, tanggal) tidak boleh berubah dari `carousel.json`.

## Memilih varian warna dan nada per kategori

| Kategori | Varian | Nada | Contoh headline |
| --- | --- | --- | --- |
| AI Law, umum, model | `editorial` (aksen kuning) | tegas, informatif | KONTEN AI MULAI DIAWASI HUKUM. |
| AI Security, risiko, ancaman | `risiko` (aksen merah) | tegang, kontrol | AI MAKIN MANDIRI. SIAPA YANG MENGAWASI? |
| AI Economy, infrastruktur, teknologi | `teknologi` (aksen cyan) | analitis, strategis | PERANG AI BUKAN CUMA SOAL KECERDASAN. |

Jangan memakai semua aksen sekaligus. Satu carousel = satu varian. Varian `default`, `tegas`, `terang` adalah warisan; jangan dipakai.

## Struktur narasi default (6 slide, boleh lebih ringkas/panjang)

1. Hook (`cover`): satu gagasan kuat. 2. Apa yang terjadi (`point`/`stat`): fakta, tanggal. 3. Konteks (`point`).
4. Kenapa penting (`point`/`comparison`). 5. Dampak atau insight (`point`/`quote`). 6. CTA + sumber (`cta`): follow, save, diskusi, atau support riset.

## Visual utama (HERO IMAGE) — KETERBATASAN YANG HARUS DILAPORKAN

Referensi menginginkan visual cinematic relevan topik di bagian atas (35-50% tinggi). **Renderer saat ini tidak punya slot gambar dan
sistem ini tidak punya sumber gambar berlisensi/generator.** Yang tersedia: pencahayaan gradient atas (glow) dan ikon lokal di `icons/`.
Aturan: jangan memalsukan visual, jangan memakai gambar dari internet. Di `summary` `complete_stage`, tulis satu kalimat
"Visual utama: belum didukung (butuh slot gambar + sumber berlisensi)" dan usulkan ikon lokal yang paling relevan.

## Checklist QC sebelum menyerahkan

- Ukuran kanvas dan margin konsisten; font Poppins; bobot sesuai.
- Background gelap, gradient terkendali; highlight warna hemat (satu per slot).
- Headline terbaca sekali pandang; label kategori dan footer konsisten.
- Tidak ada nomor halaman atau dekorasi tidak perlu.
- Ejaan, tanggal, angka, nama produk sesuai `carousel.json`; sumber mendukung klaim.
- Semua slide terasa satu brand; CTA sesuai tujuan.
- `render_carousel` mengembalikan `passed=true`.

Prinsip: konsistensi identitas, fleksibilitas eksekusi. Setiap desain langsung terasa edukasiai.co.id, tetapi tiap topik punya cerita khas.
