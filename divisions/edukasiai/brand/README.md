# Brand kit EdukasiAI (F1.6)

Struktur yang diharapkan:

```
brand/
├── brand.json        # palet, font, logo, margin, kanvas default 1080x1350
├── templates.json    # daftar template + slot + batas karakter per slot
├── templates/        # cover.html, point.html, stat.html, quote.html, comparison.html, cta.html (+ css)
├── fonts/            # file font lokal (dengan lisensi yang mengizinkan)
└── icons/            # set ikon lokal (lisensi jelas)
```

Status: menunggu jawaban owner apakah EdukasiAI sudah punya logo, palet, dan font.
Jika belum, Claude Code mengusulkan brand kit sementara untuk disetujui owner sebelum template dibuat.

---

## Status per 2026-10-05 (F1.6)

Brand kit **sementara** sudah dibuat Claude Code karena owner belum menyediakan logo, palet, dan font.
Ditandai `"status": "sementara"` di `brand.json`. **Harus disetujui atau diganti owner sebelum produksi.**

Yang sudah ada:

| Berkas | Isi |
| --- | --- |
| `brand.json` | 3 varian warna (`default`, `tegas`, `terang`), tipografi, kanvas 1080×1350, ambang kontras 4,5 dan font minimum 28px |
| `templates.json` | 6 template + slot + `maxChars` per slot. Renderer menolak slot asing dan slot yang melebihi batas |
| `templates/base.css` | CSS bersama. Tidak memuat satu pun nilai warna — semua lewat CSS custom property dari `brand.json` |
| `templates/*.html` | `cover`, `point`, `stat`, `quote`, `comparison`, `cta` |
| `contoh-design.json` | Contoh desain 6 slide untuk menguji renderer |

Yang **belum** ada dan masih memblokir:

- **`fonts/` kosong.** Template memakai font sistem (Segoe UI). Akibatnya hash PNG tidak stabil antar mesin,
  padahal approval di F2.2 mengikat hash. Memaketkan font berlisensi jelas adalah prasyarat, bukan pemanis.
- **`icons/` kosong.** Renderer sudah memvalidasi keberadaan ikon, tetapi belum pernah merender satu pun.
- **Logo masih teks**, belum ada berkas gambar.

Coba render:

```powershell
node scripts/render.mjs --design divisions/edukasiai/brand/contoh-design.json
```
