# ADR-0003: Office View memakai Pixel Agents + bridge Paperclip

- Status: Diterima (diverifikasi di spike U4.0)
- Tanggal: 2026-10-08
- Penulis: Claude (chat), atas permintaan owner

## Konteks

Owner menginginkan UI berupa kantor pixel art yang **dinamis**: karakter = agent AI, punya nama dan badge status,
berpindah antar ruang (meja kerja, ruang rapat, lounge) sesuai pekerjaan nyata. Referensi: `docs/ui/referensi-office-view.png`.
Syarat: aset pixel gratis, UI tidak memakai token LLM (digerakkan oleh data/log agent), dan tidak bisa dipakai untuk approve.

## Kandidat yang diperiksa (8 Okt 2026)

| Proyek | Lisensi kode | Lisensi aset | Catatan |
| --- | --- | --- | --- |
| Pixel Agents (`pixel-agents-hq/pixel-agents` v1.4.1) | MIT | Karakter: MetroCity oleh JIK-A-4, **CC0**. Furniture/lantai/dinding dibundel di repo | Ada mode standalone web (`npx pixel-agents`), Areas bernama, skema event agen CLI-agnostik (`core/asyncapi.yaml`), konsep provider per sumber agen |
| Agents in the Office (`gukosowa/agents-in-the-office`) | MIT | Karakter MetroCity (CC0); tile RPG Maker **tidak** dibundel | Perilaku sangat dinamis (NPC berjalan ke objek, wander, ngobrol), tapi aplikasi desktop Tauri dan butuh tileset sendiri |
| Star Office UI (`ringhyacinth/Star-Office-UI`) | MIT | **Dilarang untuk komersial** | Ditolak: Mega Class Digital bisa memakainya untuk klien |

## Keputusan

Pakai **Pixel Agents** sebagai mesin tampilan, ditambah **bridge Paperclip** milik kita yang mengubah aktivitas Paperclip
(run, status issue, handoff, approval) menjadi agent event Pixel Agents. Perilaku dinamis (berjalan antar ruang, membawa dokumen
saat handoff, ke meja owner saat menunggu approval) ditambahkan bila belum ada.

Urutan preferensi integrasi, dipilih di spike U4.0:
1. Bridge eksternal tanpa mengubah Pixel Agents (provider atau pesan WebSocket yang didukung).
2. Jika tidak mungkin: fork ringan Pixel Agents di `apps/office-view/`, versi dipin. Fork diizinkan karena ini lapisan tampilan, bukan core.

## Konsekuensi

- UI **read-only**: tidak ada tombol approve/reject. Approval tetap lewat plugin `aao-approval-gate`.
- Tidak ada panggilan LLM. Semua gerakan deterministik dari data.
- Server Office View hanya bind ke `127.0.0.1`.
- Asal-usul dan lisensi setiap aset dicatat di `docs/ui/asset-licenses.md` sebelum dipakai.
