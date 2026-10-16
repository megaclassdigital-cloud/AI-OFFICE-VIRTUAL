# ADR-0005: Brief aktif oleh Manager, penjadwal berbasis kesegaran, dan autoposting dengan browser use

- Status: Diterima (keputusan owner 2026-10-16). Menggantikan sebagian ADR-0004: butir 4 ("riset hanya atas perintah owner") dan butir 6 ("tidak ada posting otomatis"). PRD butir 144 ("tidak ada posting otomatis di MVP") berakhir bersama ADR ini.
- Tanggal: 2026-10-16
- Penulis: Claude Code (Sonnet) bersama Owner (Farrel)

## Konteks

Pipeline sudah menghasilkan paket carousel yang lolos QA dan menunggu keputusan owner. Owner ingin tiga hal berikutnya:
1. Satu karyawan **autoposting** yang memakai **browser use** (Instagram dan TikTok).
2. **Manager aktif mengeluarkan lebih dari satu brief** sendiri; owner cukup memberi saran/revisi. Prinsipnya: konten harus **hangat**, yaitu sesegar beritanya.
3. Bila perlu, karyawan **content planner** untuk jadwal posting. Owner meminta saran, dengan prioritas **efisiensi kuota** (Manager sudah memakai banyak model) dan **konsistensi waktu posting dengan hangatnya tren**.

Pilihan metode posting dijawab owner: **browser use untuk kedua platform**, karena API TikTok tidak tersedia untuk kebutuhan tidak resmi dan aturan Meta sering berubah; satu metode lintas platform lebih seimbang. Owner paham risikonya (lihat Konsekuensi).

## Keputusan

### 1. Autoposter: runner browser berbasis kode + karyawan LLM ringan untuk persiapan

- **Runner** (`scripts/autopost/`): skrip Playwright per platform dengan langkah eksplisit (selector + pemeriksaan tiap langkah), memakai **profil browser khusus** (`workspace/browser-profile-social/`) yang di-login **manual oleh owner** lewat `scripts/browser-login.mjs --platform <nama>`. Kata sandi tidak pernah dipegang Claude atau agen.
- **Runner tidak berimprovisasi.** Bila halaman tidak cocok dengan yang diharapkan (UI berubah, sesi habis, dialog tak dikenal), runner **berhenti sebelum klik final**, menyimpan tangkapan layar sebagai bukti, dan memberi tahu owner. Klik final hanya dijalankan setelah semua pemeriksaan lolos.
- **Karyawan Autoposter (LLM ringan)** hanya menyiapkan: caption dan hashtag per platform dari draf yang sudah disetujui, memeriksa kelengkapan paket, memicu runner, dan memverifikasi bukti hasil. Ia **tidak memegang otoritas** atas approval atau waktu posting.
- **Hanya konten yang sudah di-approve owner** (record approval berstatus approved dengan hash yang cocok, F2.2) yang boleh diposting. Approval owner + slot jadwal = izin posting untuk konten itu.
- **Pagar keamanan wajib:** (a) **dry-run adalah bawaan**; mode live dinyalakan owner per platform setelah meninjau hasil dry-run; (b) **kill switch** (`workspace/autopost-settings.json` `paused:true`, tombol di TV) menghentikan semua posting seketika; (c) **ledger idempotensi** (konten x platform): tidak pernah mengirim dua kali; status tak pasti (`tidak_pasti`) menunggu pemeriksaan owner, tidak dicoba ulang otomatis; (d) batas harian per platform dan jeda antar posting; (e) tiap posting menyimpan tangkapan layar sebelum dan sesudah klik final.

### 2. Manager aktif mengeluarkan brief (menggantikan ADR-0004 butir 4)

- **Penarikan (pull), bukan dorongan:** brief baru dibuat hanya bila ada **slot jadwal kosong** dalam horizon pendek (bawaan 24 jam) yang belum punya konten dalam produksi. Ini menjaga konten tetap hangat dan kuota tidak terbuang.
- **Sapuan tren murah:** satu run Researcher (model ringan) memindai berita terbaru; **kode** memberi skor kesegaran dan memilah topik (melanjutkan pemilah topik ADR-0004). Manager (model mahal) hanya dipanggil **sekali per gelombang** untuk menulis brief singkat per topik terpilih. Satu sapuan melayani beberapa brief (biaya terbagi).
- **Prinsip konten hangat** ada di instruksi Manager: topik berumur lebih dari `freshHours` (bawaan 48 jam sejak sumber terbaru) tidak dibuat.
- **Batas tetap berlaku:** antrean menunggu approval maksimal 5 berkas, maksimal 3 job aktif, guard kuota `limits.json`. Mode tinjau rencana tetap bisa menahan brief sebelum berjalan; owner memberi saran/revisi lewat chat.

### 3. Penjadwal adalah KODE, bukan agen planner LLM

Jawaban atas pertanyaan owner:
- **Risiko konten basi:** ya, ada bila rencana panjang. Karena itu horizon produksi pendek (penarikan di atas), tiap konten punya `freshUntil`, dan konten yang melewatinya tanpa slot ditandai `kedaluwarsa` (owner memutuskan; tidak diposting otomatis).
- **Risiko Manager kelebihan beban:** ya, bila Manager juga menyusun kalender. Penjadwal berbasis kode **tidak memakai kuota sama sekali** dan dapat dites.
- Aturan penjadwal: jendela jam posting milik owner (bawaan WIB 07:00-09:00, 12:00-13:30, 19:00-21:30), batas per hari per platform, jeda minimum, jitter menit deterministik, urutan **deadline terdekat dulu** (earliest `freshUntil` first).
- Agen planner LLM dapat dipertimbangkan kembali nanti bila ada data kinerja posting untuk menentukan jam terbaik.

## Alternatif yang dipertimbangkan

- **Instagram Graph API.** Lebih stabil dan resmi, tetapi tidak konsisten dengan TikTok (API resmi tidak tersedia untuk kebutuhan ini) dan bergantung pada kebijakan Meta yang sering berubah. Ditolak owner demi satu metode lintas platform.
- **Agen LLM mengendalikan browser secara bebas.** Ditolak: rawan salah klik pada aksi tak terpulihkan (posting). Dipilih runner berbasis kode; LLM hanya menyiapkan dan memverifikasi.
- **Planner LLM terpisah / Manager sebagai penjadwal.** Ditolak: memakan kuota, dan menambah risiko basi serta kelebihan beban (lihat butir 3).
- **Produksi massal terjadwal tanpa slot (dorongan).** Ditolak: menumpuk approval dan membuat konten basi.

## Konsekuensi

- **Risiko ketentuan platform:** otomatisasi browser pada Instagram/TikTok bertentangan dengan ketentuan layanan keduanya dan dapat membuat akun dibatasi. Owner menerima risiko ini; pagar (dry-run, batas harian, jeda, kill switch) mengurangi kemungkinan tetapi tidak meniadakannya.
- **Kerapuhan UI:** perubahan tampilan situs akan merusak runner; ia berhenti aman (tanpa klik final) dan memberi tahu owner. Perlu pemeliharaan selector.
- **Sesi login** dapat kedaluwarsa; runner mendeteksi dan meminta owner login ulang.
- **TikTok web:** unggah carousel foto di web perlu diverifikasi saat membangun; bila tidak didukung, alternatifnya slideshow video dari slide (keputusan lanjutan).
- **Aturan tertulis yang kini usang:** CLAUDE.md butir 9 ("tidak ada posting otomatis") dan PRD butir 144. Claude tidak boleh mengubah CLAUDE.md; dicatat sebagai `REVIEW-OWNER` (D-020) agar owner yang memperbaruinya.
- Plugin tetap generik (aturan 10): logika platform ada di `divisions/edukasiai/` dan `scripts/autopost/`, bukan di `plugins/`.

## Rencana implementasi (bertahap; tiap tahap dites dan bisa dihentikan)

- **P1. Penjadwal kesegaran** (`scripts/scheduler.mjs`): model data, slot dari jendela owner, `freshUntil`, urutan deadline, sinyal "slot kosong" untuk Manager. Murni, dengan tes. Tanpa efek ke luar.
- **P2. Autoposter dry-run:** login manual per platform, runner Instagram dan TikTok sampai tepat sebelum klik final, bukti tangkapan layar, ledger, kill switch.
- **P3. Manager aktif:** sapuan tren, pemilahan oleh kode, penulisan brief oleh Manager hanya saat ada slot kosong.
- **P4. Tampilan TV:** jadwal, status posting, kedaluwarsa, kill switch, tombol live per platform.
- **P5. Mode live** per platform atas keputusan owner setelah dry-run ditinjau.

## Cara memverifikasi

- Tes penjadwal: slot hanya di dalam jendela owner; batas harian dan jeda dihormati; konten dengan `freshUntil` terdekat mendapat slot lebih dulu; konten yang kehilangan semua slot menjadi `kedaluwarsa`.
- Tes pagar autoposter: tanpa approval/hash cocok ditolak; `paused:true` menolak; ledger mencegah kirim ganda; status tak pasti tidak dicoba ulang; dry-run tidak pernah mengklik tombol final.
- Bukti end-to-end dry-run: satu konten approved menghasilkan tangkapan layar halaman unggah terisi lengkap di tiap platform tanpa terkirim.
