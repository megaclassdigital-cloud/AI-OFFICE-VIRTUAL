# Office View — spesifikasi UI kantor dinamis

Referensi visual: `referensi-office-view.png`. Keputusan teknis: `docs/decisions/ADR-0003-office-view-pixel-agents.md`.

## Prinsip

1. **Data-driven, nol token.** Setiap gerakan berasal dari data Paperclip (run, issue, komentar, approval). Tidak ada LLM di UI.
2. **Dinamis, bukan dekorasi.** Karakter berpindah ruang saat pekerjaannya berubah, bukan sekadar duduk diam dengan label status.
3. **Read-only.** UI hanya menampilkan. Approve/reject tetap lewat jalur deterministik di plugin.
4. **Jujur.** Animasi tidak boleh mengklaim sesuatu yang tidak terjadi; status diambil dari data, bukan ditebak.

## Denah kantor EdukasiAI

| Ruang | Isi | Dipakai untuk |
| --- | --- | --- |
| Ruang Riset | Meja Researcher, meja Verifier | Riset dan verifikasi sumber |
| Studio Konten | Meja Copywriter, meja Designer | Menulis dan mendesain carousel |
| Meja QA | Meja QA | Pemeriksaan kualitas |
| Meja Owner | Meja owner + "kotak approval" | Paket yang menunggu approval |
| Ruang Publikasi (kaca) | Meja Admin Publikasi | Pekerja kode tanpa LLM: memposting konten yang di-approve (status dari status.json pekerja) |
| Papan Tayang | Papan di dinding | Paket yang sudah approved dan siap posting |
| Lounge | Sofa, mesin kopi | Agent idle |
| Pojok Bug | Meja kecil dengan tanda ⚠ | Run error atau `needs_human` |

Denah disimpan sebagai data di `divisions/edukasiai/office/layout.json`, sehingga division lain (misalnya MegaClassDigital) cukup membuat denahnya sendiri.

## Karakter

- Satu karakter per agent Paperclip, ditambah satu karakter owner.
- **Name tag:** nama agent dan peran, ditambah ID issue yang sedang dikerjakan (mis. `Copywriter · EDU-12`).
- **Bubble status:** emoji di atas kepala (tabel di bawah).
- **Badge di meja owner:** jumlah paket yang menunggu approval.

## Pemetaan status ke perilaku

| Kejadian di Paperclip | Perilaku karakter | Bubble |
| --- | --- | --- |
| Run agent dimulai pada issue | Berjalan ke mejanya, animasi mengetik | ⌨️ + judul issue singkat |
| Tool dipanggil (komentar, render, verifikasi) | Tetap di meja, ikon tool | 💬 / 🎨 / 🔎 |
| Issue diserahkan ke agent berikutnya | Berjalan membawa dokumen ke meja agent tujuan, lalu kembali | 📄 |
| QA gagal (teks atau visual) | QA berjalan ke meja Copywriter/Designer mengembalikan dokumen | ❌ |
| Status `awaiting_approval` | Agent terakhir berjalan ke Meja Owner, meletakkan paket; badge owner bertambah | ✋ |
| Approved | Paket pindah ke Papan Tayang | 🎉 |
| Rejected | Owner mengembalikan dokumen ke Copywriter | ↩️ |
| `needs_human` atau run error | Agent ke Pojok Bug | ⚠️ / 🐞 |
| Guard pemakaian aktif (F1.0f) | Agent tertidur di meja | 😴 |
| Tidak ada run aktif | Ke Lounge, sesekali berpindah sofa/mesin kopi | ☕ |
| Gate review berjalan | Agent terkait berkumpul di Ruang Rapat | 🗂️ |

## Arsitektur

```
Paperclip API (127.0.0.1:3177) ──poll/subscribe──▶ office-bridge (deterministik)
                                                    │  normalisasi → office event
                                                    ▼
                                         Pixel Agents (standalone web, 127.0.0.1)
                                                    │
                                                 Browser owner
```

- `office-bridge` membaca, tidak menulis ke Paperclip.
- Interval polling ≤ 5 detik jika tidak ada stream realtime; jeda event ke animasi ≤ 5 detik.
- Bridge dapat memutar ulang rekaman event (`fixtures/office-events/*.jsonl`) untuk demo dan test tanpa menjalankan agent.

## Kriteria diterima

| ID | Kriteria | Bukti |
| --- | --- | --- |
| ACU.1 | Office View berjalan lokal di Windows, 6 karakter (5 agent + owner) tampil dengan name tag | Screenshot |
| ACU.2 | Replay event pipeline E1.1 menghasilkan perpindahan ruang sesuai tabel pemetaan | GIF/rangkaian screenshot + log event |
| ACU.3 | Event nyata dari Paperclip tampil di UI dalam ≤ 5 detik | Log waktu event vs render |
| ACU.4 | UI tidak memanggil LLM dan tidak punya aksi tulis ke Paperclip | Daftar request jaringan + review kode |
| ACU.5 | Semua aset punya lisensi yang mengizinkan pemakaian komersial | `docs/ui/asset-licenses.md` |
