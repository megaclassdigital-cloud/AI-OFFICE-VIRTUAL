# Template perintah Manager ke tiap divisi (work order)

Dipakai Manager (ChatGPT atau Claude; hasilnya harus sama bentuknya apa pun modelnya). Penerima perintah adalah agent berbasis model gratis,
jadi perintah harus **eksplisit, berurutan, dan bisa diperiksa**. Sesuaikan isi dengan brief owner; jangan menyalin contoh mentah-mentah.

## Struktur wajib setiap instruksi tahap

Setiap tahap ditulis dengan label persis berikut, masing-masing di barisnya sendiri:

```
Tujuan: satu kalimat apa yang harus tercapai.
Masukan: berkas/path yang dibaca (hasil tahap sebelumnya) dan data dari brief.
Batasan: apa yang dilarang (karang angka/nama/tanggal, sumber di luar daftar, format di luar brand kit), batas jumlah/panjang.
Keluaran: bentuk dan nama berkas yang harus ditulis.
Selesai bila: kriteria yang bisa diperiksa mesin.
```

Kode memeriksa label ini; perintah tanpa struktur dikembalikan kepadamu untuk diperbaiki. Hormati batas 4000 karakter per tahap.

## Penyesuaian per divisi (kedalaman perintah sesuai kemampuan agent)

- **Researcher** (model gratis, rawan menebak): tulis kata kunci pencarian, rentang tanggal (mis. 7 hari terakhir), jumlah kandidat (5), dan larangan menulis berita lama. Minta URL sumber primer. Bila brief menyebut nama produk yang tidak kamu kenal, minta Researcher memastikan produk itu ada dengan sumber resmi sebelum meriset isinya.
- **Verifier**: sebut aturan penolakan (URL tidak terjangkau, tanggal di luar rentang, klaim tanpa sumber) dan bahwa status ragu/ditolak harus ditulis apa adanya.
- **Copywriter**: jumlah slide 6-10, peran tiap slide (hook, point, stat, quote, comparison, cta), `blocks` untuk slide kartu/alur/daftar, `visualIdea` untuk slide yang butuh gambar atau logo merek, dan larangan fakta di luar sumber terverifikasi.
- **Designer**: template per slide dari brand kit (cover/hero-cover, point/hero-explain/compare-cards/flow/icon-list, stat, quote, comparison, cta/hero-cta), `asset-requests.json` untuk tiap gambar (merek = `kind: brand`, nama resmi), nama berkas gambar BARU bila mengganti gambar lama, dan warna fleksibel.
- **QA**: periksa teks dan desain terhadap brief; untuk gambar, cek keaslian logo/produk dan relevansi foto dengan membuka PNG hasil render.

## Satu konten per work order

Satu work order = satu carousel dari satu topik. Bila brief memuat beberapa topik terpisah, pilih yang paling utama untuk work order ini
dan tulis di `title` serta instruksi Researcher bahwa topik lain diantrekan sebagai konten terpisah; jangan menggabungkan topik yang tidak terkait.
