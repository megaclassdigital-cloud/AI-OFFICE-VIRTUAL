# ADR-0004: Berkas konten, antrian, dan kerja berkelanjutan di bawah Manager

- Status: Diterima (keputusan owner 2026-10-09; rincian implementasi menunggu persetujuan backlog)
- Tanggal: 2026-10-09
- Penulis: Claude Code (Sonnet) bersama Owner (Farrel)

## Konteks

Saat ini satu produksi = satu carousel. Researcher dan Verifier menghasilkan banyak kandidat terverifikasi (EDU-27: 8), tetapi Copywriter hanya merangkai
satu angle; kandidat lain terbuang tanpa tanda, lalu pipeline berhenti menunggu brief baru. Owner ingin divisi bekerja berkelanjutan,
tiap konten punya "berkas" sendiri yang rapi dan siap diteruskan, dan berlaku untuk semua divisi.

## Keputusan

1. **Berkas konten (dossier) adalah unit kerja.** Satu berkas = satu konten: judul topik dan angle, sumber terverifikasi yang "diklip" ke berkas itu saja,
   daftar dokumen wajib per tahap, dan status tiap dokumen (kosong, draf, lengkap). Konten berbeda berarti berkas berbeda.
2. **Pemilah topik adalah kode, bukan LLM.** Setelah Verifier, kode mengelompokkan kandidat terverifikasi menjadi **maksimal 3 berkas per riset**
   (hemat token); sisanya berstatus "ditunda" dengan alasan yang tercatat. Satu berkas boleh memuat beberapa sumber yang terkait satu angle
   (mis. carousel rangkuman). Asumsi ini ditandai terbuka untuk dikonfirmasi owner.
3. **Setiap tahap selain Researcher memindai hasil riset berkasnya lalu menyimpulkannya menjadi dokumen keluaran tahap itu**, siap dilaporkan ke tahap/divisi
   berikutnya. Gerbang per berkas: tahap berikutnya hanya mulai bila semua dokumen wajib tahap sebelumnya berstatus lengkap (memperluas gerbang keluaran yang sudah ada).
4. **Riset hanya dimulai atas perintah owner**: ide atau brief, atau "lanjutkan konten baru". Tidak ada riset ulang otomatis. **Manager bertanggung jawab**
   melaporkan pemakaian (usage) tiap agen dan mempertimbangkan kuota kosong atau limit sebelum memulai pekerjaan.
5. **Antrian dan batas.** Berkas diproses satu per satu (kuota model gratis terbatas). Antrian approval maksimal 5 berkas; setelah itu kerja baru dihentikan
   sementara. Selama ada diskusi dengan owner tidak boleh ada bottleneck: Manager tetap responsif dan melapor konsisten. Owner dapat mengembalikan berkas untuk revisi
   (mekanisme revisi sudah ada: brief `mode: revisi`, mulai dari tahap tertentu, memakai ulang artefak sumber).
6. **Tetap berlaku:** tidak ada posting otomatis dan tidak ada `git push` (aturan 9). "Siap diteruskan" berarti paket menunggu keputusan owner. Konsep berkas
   bersifat netral lintas divisi; isi khusus EdukasiAI (carousel, template, aset) tetap di `divisions/edukasiai/`, bukan di `plugins/` (aturan 10).

## Alternatif yang dipertimbangkan

- **Satu produksi per kandidat otomatis.** Ditolak: menghabiskan kuota gratis dan menumpuk approval tanpa batas.
- **LLM sebagai pemilah topik.** Ditolak: keputusan pengelompokan sulit diperiksa dan memakan kuota; kode deterministik dapat dites.
- **Riset terjadwal otomatis.** Ditolak oleh owner: riset dimulai atas perintah agar pemakaian kuota terkendali.

## Konsekuensi

- Status job di orkestrator berubah dari satu job menjadi antrian berkas (state baru, kompatibel mundur dengan job tunggal).
- Perlu laporan pemakaian per agen (dari `limits.json`, run Paperclip, dan model aktif) yang bisa diminta Manager dan tampil di panel.
- Perlu tampilan "Berkas" di Office View/TV (antrian, status dokumen, ditunda).
- Kuota model gratis tetap membatasi laju; penjadwal wajib berhenti saat kuota habis dan melapor.

## Rencana implementasi (usulan; menunggu persetujuan masuk backlog)

- B1: skema `berkas` dan penyimpanan di `workspace/agent/berkas/<ID>/` (dokumen wajib per tahap, status).
- B2: pemilah topik `select-berkas.mjs` (deterministik, maksimal 3 berkas, alasan "ditunda") dengan tes.
- B3: orkestrator memproses antrian berkas satu per satu, memulai dari Copywriter memakai artefak berkas (memakai ulang mekanisme revisi).
- B4: gerbang kelengkapan dokumen per tahap dan "pemindaian riset" di instruksi tiap agen.
- B5: laporan pemakaian per agen untuk Manager dan panel; Manager melapor sebelum memulai riset.
- B6: perintah owner "lanjutkan konten baru" memulai riset; tampilan Berkas di TV; batas 5 berkas menunggu approval.

## Cara memverifikasi

- Tes pemilah topik: kandidat dikelompokkan sesuai entitas/angle, maksimal 3 berkas, sisanya "ditunda" dengan alasan.
- Tes antrian: berkas diproses berurutan; berkas ke-6 menunggu saat 5 berkas belum diputuskan owner.
- Tes gerbang: tahap tidak maju bila dokumen wajib belum lengkap.
- Bukti end-to-end: satu riset menghasilkan 2-3 berkas yang selesai berurutan dan masuk antrian approval.

## Keputusan tambahan: tombol keputusan owner dan routing revisi (2026-10-09)

- Owner memutuskan di Office View lewat tombol **Setujui / Tolak**; Tolak mewajibkan alasan. Tombol memakai **PIN owner** (hash scrypt di `.env`, diatur dengan `node scripts/owner-pin.mjs set`),
  dengan pembatas percobaan salah. PIN hanya melindungi jalur tombol; token owner di `.env` tetap dapat dibaca proses lokal (FIX-G3-02, terpisah).
- **Default routing revisi: Manager yang menentukan** tahap awal (`copywriter` atau `designer`) berdasarkan SOP `divisions/edukasiai/sop/revisi-routing.md`; Manager bertanggung jawab atas pilihannya.
  Owner dapat memaksa tahap lewat pilihan di formulir. KODE memvalidasi keputusan dan menjalankannya (mode revisi): hanya berkas yang ditolak, tahap sebelumnya disalin tanpa kuota, tidak ada agent lain tersentuh.
- Jendela batal 60 detik sebelum revisi berjalan; bila Manager tidak menjawab dalam 10 menit atau keputusannya tidak valid, aturan kata kunci menggantikan dan dicatat.
- Masalah fakta/sumber tidak diperbaiki di mode revisi (riset tidak diulang): ditandai agar owner memberi perintah riset baru.
