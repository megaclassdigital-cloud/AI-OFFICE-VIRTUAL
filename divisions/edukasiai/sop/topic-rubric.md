# Rubrik pemilihan topik — EdukasiAI

Dipakai pada tahap pemilihan topik, setelah Verifier. Kamu hanya boleh menilai kandidat yang berstatus
`verified` di `verification-result`. Kandidat `rejected` tidak boleh dinilai atau dipilih.

## Tiga kriteria, skor bulat 1–5

| Kriteria | 1 | 3 | 5 |
| --- | --- | --- | --- |
| **Relevansi Indonesia** | Tidak ada kaitan dengan pembaca Indonesia | Bisa dihubungkan ke profesional, pelajar, atau pelaku usaha Indonesia dengan sedikit konteks | Langsung menyentuh pekerjaan, regulasi, produk, atau kebiasaan pembaca Indonesia |
| **Kebaruan** | Cerita lama atau pengulangan | Perkembangan baru atas topik yang sudah dikenal | Pengumuman atau temuan pertama dalam 7 hari terakhir |
| **Dampak** | Perubahan kecil, hanya untuk segelintir orang | Mengubah cara sebagian pengguna bekerja | Mengubah praktik luas atau mengubah aturan |

Total = relevansi + kebaruan + dampak (maksimal 15). **Total dihitung kode**, jangan menulisnya sendiri.

## Aturan

1. Nilai semua kandidat terverifikasi (`ranking`), bukan hanya yang menang.
2. Pilih satu kandidat. Biasanya yang total skornya tertinggi. Memilih yang bukan tertinggi boleh,
   tetapi alasannya harus menjelaskan kenapa; kode akan menandainya untuk ditinjau owner.
3. `reason` wajib: 20–600 karakter, sebut skor dan satu alasan konkret untuk pembaca Indonesia.
4. Hanya klaim yang ada di ringkasan sumber. Jangan menambah fakta baru dalam alasan.
5. Keputusan akhir tetap di tangan owner pada tahap approval; ini hanya usulan.
