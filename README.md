# Monitor kedua (Vercel, hanya-baca)

Salinan **Office View** yang sama dengan desktop (kantor pixel art, simulasi, TV, panel agen, approval, status posting, kantor otonom), untuk dilihat dari perangkat lain.
**Hanya-baca:** tidak ada chat ke Manager dan tidak ada tombol keputusan. Data adalah *salinan dengan jeda* (puluhan detik), bukan koneksi langsung ke laptop.

```
laptop (Office View lokal, agen)            Vercel (proyek ini)
  scripts/mirror-publisher.mjs  --POST-->   api/ingest.js  --> Blob PRIVAT
  (baca-saja, berurutan, melambat)          api/data.js    <-- browser (cookie sesi)
```

* Laptop **tidak menerima koneksi masuk**. Publisher hanya GET ke Office View lokal dan POST keluar ke `/api/ingest`.
* Data dibersihkan SEBELUM keluar dari laptop (`scripts/mirror/scrub.mjs`): jalur lokal, rahasia, surel, id internal; kutipan komentar agen dibuang.
* Semua halaman butuh cookie dari tautan `/review?key=...` (middleware gagal-tertutup).
* Bila laptop mati/offline, monitor menampilkan keadaan terakhir dengan peringatan merah "Laptop tidak mengirim data".
* Publisher tidak mengganggu agen: prioritas rendah, permintaan berurutan dengan jeda, Paperclip dibaca paling cepat tiap 60-90 dtk (lebih lambat saat sepi), berhenti sejenak bila RAM bebas < 500 MB.

## Pasang (sekali, oleh owner)

1. **Rahasia:** `node scripts/setup-monitor.mjs` (membuat nilai di `.env` dan `vercel-monitor/ENV-UNTUK-VERCEL.txt`; tidak dicetak).
2. **GitHub:** branch `client-demo` (berisi folder ini) di repo `megaclassdigital-cloud/AI-OFFICE-VIRTUAL`.
3. **Vercel:** Add New Project > impor repo > pilih branch `client-demo` > **Root Directory = `vercel-monitor`** > Framework "Other".
4. **Blob:** Storage > Create > Blob, akses **Private**, hubungkan ke proyek (menambah `BLOB_READ_WRITE_TOKEN`).
5. **Env:** tempel isi `ENV-UNTUK-VERCEL.txt` ke Settings > Environment Variables (Production), lalu Redeploy.
6. **Laptop:** `node scripts/setup-monitor.mjs --url https://<proyek>.vercel.app`, lalu jalankan publisher: `node scripts/mirror-publisher.mjs --watch`.
7. **Buka:** `https://<proyek>.vercel.app/review?key=<MIRROR_REVIEW_KEY di .env>` (cookie berlaku 7 hari).

## Latihan lokal tanpa Vercel

```
set MIRROR_FS_DIR=D:\temp\mirror-uji & set MIRROR_INGEST_SECRET=... & set MIRROR_REVIEW_KEY=... & set MIRROR_SESSION_SECRET=...
node vercel-monitor/dev-server.mjs --port 3199
set MIRROR_URL=http://127.0.0.1:3199 & node scripts/mirror-publisher.mjs --once
```

## Setelah mengubah frontend Office View

`node scripts/build-monitor-site.mjs` (menyalin `apps/office-view/public` ke `vercel-monitor/public`). Tes `mirror-monitor` gagal bila salinan tidak sinkron.

## Keamanan

* Rotasi tautan: `node scripts/setup-monitor.mjs --rotate-review-key` (perbarui di Vercel, Redeploy). Putuskan semua sesi: `--rotate-secret`.
* Matikan sementara: buat berkas `workspace/mirror/PAUSE` atau set `enabled:false` di `workspace/mirror/settings.json`.
* Mode owner (kirim perintah ke Manager dari perangkat lain) sengaja belum ada; dibuat setelah monitor hanya-baca terbukti.
