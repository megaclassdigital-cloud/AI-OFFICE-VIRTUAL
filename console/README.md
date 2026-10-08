# Office Console

UI web **read-only** untuk AI Agent Office (spesifikasi awal bagian 24, 26, 27). Tidak mengubah Paperclip (ADR-0001):
hanya membaca API Paperclip dan berkas render di `workspace/`.

```powershell
npm run console          # http://127.0.0.1:3180
node console/server.mjs --port 3180 --paperclip http://127.0.0.1:3177
```

Jalur tampilan: **Office → Division → Agent → Task & workflow → Approval → Output → Audit**, plus **Pemakaian token**
per agent dan per hari terhadap batas harian (`divisions/<id>/limits.json`).

Aturan:

- Hanya `GET`; semua metode lain 405. Mendengar di `127.0.0.1`.
- `Office Mega Class` dan `IsolationTest` tidak dibaca dan tidak ditampilkan.
- Berkas hasil hanya `slide-NN.png`, `contact-sheet.png`, `visual-qa.json`, `hashes.json` milik issue ber-UUID valid.
- Teks dari agent dirender dengan `textContent`, bukan `innerHTML`.
- Belum ada tombol approve/reject: itu tahap F2.1 dan memerlukan token owner.
