# Penamaan dan filing hasil produksi

Keputusan owner (9 Okt 2026): **kode konten tidak pernah berubah.** Revisi, percobaan ulang, dan produksi yang gagal tetap memegang kode EDU yang sama.

## Tiga jenis nomor EDU

| Nomor | Contoh | Dilihat siapa | Arti |
| --- | --- | --- | --- |
| **Kode konten** | `EDU-97` | owner, TV, log, nama folder | identitas satu konten, tetap selamanya |
| Nomor master Paperclip | `EDU-105` | internal | issue master milik sebuah revisi; dipetakan ke folder lewat `run.json` |
| Nomor issue tahap | `EDU-106` … `EDU-114` | internal | satu issue per tahap per percobaan; boleh dibatalkan |

Log orkestrator, papan TV, dan `RIWAYAT.md` menampilkan kode konten ("EDU-97 · revisi 1"). Nomor lain hanya muncul sebagai "issue internal".

## Susunan folder (`workspace/agent/runs/`)

```
runs/
  INDEX.md                 daftar semua konten (otomatis)
  EDU-97/
    RIWAYAT.md             riwayat satu konten: versi, putaran QA, status aset (otomatis)
    carousel.json, carousel-design.json, assets/, render/, qa-result.json ...   versi ASLI
    arsip/                 hasil lama yang diganti (qa-putaran-N-*), dipindah bukan dihapus
    _sisa-alat/            sisa berkas bantu agen (parameter tool); aman diabaikan
    revision-1/            revisi 1: isi sama seperti versi asli, hasil TERBARU revisi itu
      arsip/qa-putaran-1-designer/   ... putaran QA yang memicu revisi
      _sisa-alat/
    revision-2/ ...
```

Aturan:
- Folder utama sebuah versi hanya berisi hasil **terbaru** versi itu. Hasil yang diganti QA dipindah ke `arsip/qa-putaran-<n>-<departemen atau dari-awal>/`.
- Manifest aset (`assets-manifest.json`) **disalin** (bukan dipindah) ke arsip saat revisi, supaya gambar yang sudah sah dipakai ulang tanpa pengambilan ulang.
- Konten yang gagal atau dibatalkan tetap di foldernya dengan kode yang sama; statusnya terbaca di `RIWAYAT.md` dan `INDEX.md`. Tidak ada folder yatim dengan nomor lain.

## Perapian otomatis

- `node scripts/run-index.mjs [--content EDU-97]`: menulis ulang `RIWAYAT.md` dan `INDEX.md` (hanya bila isinya berubah). Orkestrator memanggilnya tiap menit untuk konten yang aktif.
- `node scripts/tidy-workspace.mjs [--apply]`: memindahkan sisa berkas bantu agen ke `_sisa-alat/`. Tanpa `--apply` hanya menampilkan rencana. Orkestrator memindahkan yang berumur lebih dari 10 menit. **Tidak ada yang dihapus.**
