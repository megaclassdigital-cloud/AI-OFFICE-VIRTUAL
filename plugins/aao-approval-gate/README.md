# aao-approval-gate

Plugin Paperclip milik kita. Dibangun di F0.4 (versi "hello") lalu F1.3, F1.8, F2.1, F2.2.

Tanggung jawab (semuanya deterministik):

- Tool verifikasi sumber: URL bisa diakses, tanggal dalam rentang (F1.3)
- Tool render carousel + cek visual (F1.8), memakai template dari `divisions/<division>/brand/`
- Approve/reject khusus owner, record approval dengan hash isi (F2.1)
- Tool `prepare_publication` yang menolak tanpa approval valid (F2.2)
- Audit log semua keputusan dan penolakan

Aturan: plugin ini generik untuk semua division. Tidak boleh ada logika yang hanya berlaku untuk EdukasiAI
(misalnya kata "carousel" yang di-hardcode). Hal spesifik division dibaca dari konfigurasi di `divisions/`.
