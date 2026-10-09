# Office View

Kantor virtual pixel art yang **dinamis**: karakter = agent Paperclip, berjalan antar ruang sesuai kejadian nyata.
Spesifikasi `docs/ui/OFFICE-VIEW.md`, keputusan `docs/decisions/ADR-0003-office-view-pixel-agents.md` (jalur mesin tampilan: D-014).

```powershell
npm run office                 # membuka http://127.0.0.1:3190 dalam mode LIVE
node apps/office-view/server.mjs --port 3190 --paperclip http://127.0.0.1:3177
```

Syarat: Paperclip hidup (`scripts\start-paperclip.ps1 -Status`). Jika mati, UI menampilkan banner "Paperclip tidak terhubung" dan mencoba lagi sendiri.

## Kolom komunikasi dengan Manager (opt-in)

```powershell
npm run office:talk            # sama seperti office, plus panel "Bicara dengan Manager" di kanan bawah
```

Pesan Anda menjadi issue yang ditugaskan ke agent **Manager** (atau komentar pada issue yang dibuat panel ini); balasan Manager muncul di panel.
Ini satu-satunya jalur tulis Office View: hanya aktif dengan `--enable-talk`, loopback + same-origin, maks 4000 karakter, jeda 5 detik, hanya company EdukasiAI. Tanpa flag, semua tetap read-only (405). Pesan membangunkan Manager (satu run model gratis).

## Mode

| Mode | Sumber | Label |
| --- | --- | --- |
| LIVE | `bridge.mjs` membaca Paperclip (GET saja) tiap 1,5 detik; UI mengambil event tiap 1 detik. Saat dibuka, keadaan terkini dibaca lebih dulu (snapshot). | `MODE: LIVE` (hijau) |
| SIMULASI | `fixtures/office-events/demo-carousel.jsonl` (±3 menit, berulang) lewat jalur `applyEvent` yang sama | `MODE: SIMULASI` (oranye) + "data contoh" |

Kontrol presenter: toggle Live/Simulasi, Play/Pause (spasi), kecepatan 1x/2x/4x (simulasi), Legenda, Log, layar penuh (`F`).

## Pemetaan data → perilaku (LIVE)

| Data Paperclip | Perilaku |
| --- | --- |
| Agent EdukasiAI ada | Karakter muncul; name tag = nama · peran · ID issue aktif |
| Run `running`/`queued` | Jalan ke meja, mengetik, bubble ⌨️ + judul issue |
| Komentar baru | 💬 |
| Assignee issue pindah A→B | A membawa 📄 ke meja B lalu kembali |
| Run selesai | Kembali ke Lounge ☕ |
| Run gagal (≤15 menit) | Pojok Bug 🐞 |
| Agent `paused` | Tidur di meja 😴 |
| Issue masuk `in_review` | Pembawa meletakkan paket di Meja Owner ✋, badge owner naik |
| Issue `blocked` | Pojok Bug ⚠️ |
| Papan Tayang, Ruang Rapat | Redup "segera aktif" (belum ada sumber data); tidak dipalsukan di mode LIVE |

## Keamanan

Hanya `GET`, bind `127.0.0.1`, tanpa LLM, tanpa permintaan ke luar 127.0.0.1, `Office Mega Class` tidak disentuh. Lisensi aset: `docs/ui/asset-licenses.md`.
Bukti: `docs/evidence/U4.L/`. Test: `tests/office-view.test.mjs`.
