# RUNBOOK — AI Agent Office (EdukasiAI)

Untuk owner (Farrel), PowerShell di Windows, folder repo `D:\AI-Memory\AI-Agent-Office`.
Penanda: **[teruji]** = perintah sudah dijalankan atau diuji di proyek ini; **[belum teruji]** = ditulis dari desain/kode, belum dijalankan pada kondisi nyata.

Aturan emas: agent tidak pernah memutuskan approve, tidak memposting, dan tidak punya token owner. Semua keputusan di bawah dijalankan **oleh Anda**.

## 1. Menyalakan dan mematikan

```powershell
.\scripts\start-paperclip.ps1            # nyalakan (detached)        [teruji]
.\scripts\start-paperclip.ps1 -Status    # cek hidup/mati             [teruji]
.\scripts\start-paperclip.ps1 -Stop      # matikan                    [teruji]
```

- Paperclip di **http://127.0.0.1:3177** (bukan 3100; itu milik ERP-KIOS). Tidak auto-start setelah reboot; nyalakan manual.
- Jangan mematikan proses Node milik ERP-KIOS atau JARVIS; kenali Paperclip lewat port 3177 (`-Stop` sudah melakukannya).
- Cek kesehatan cepat tanpa menjalankan agent: `node scripts/smoke-test.mjs` (37 cek) **[teruji]**.
- Log server: `workspace\paperclip-server.out.log` dan `.err.log`.

Tampilan:

```powershell
npm run console    # Office Console (read-only): http://127.0.0.1:3180   [teruji]
npm run office     # Office View (kantor virtual): http://127.0.0.1:3190 [teruji]
```

## 2. Memasang atau memperbarui division

Setelah mengubah instruksi agent di `divisions\edukasiai\`:

```powershell
node scripts\install-division.mjs         # idempoten: 5 agent, 1 company     [teruji]
node scripts\install-division.mjs --dry-run
```

Menjalankannya berulang tidak membuat agent atau company ganda (terbukti di `docs/evidence/H3.3/install-idempotent.txt`).

## 3. Sekali saja: membuat token owner

```powershell
node scripts\owner-approval.mjs init      # membuat AAO_OWNER_TOKEN di .env   [teruji]
```

- `.env` tidak di-commit. **Jangan bagikan** token ini dan jangan taruh di chat.
- Token menandatangani setiap keputusan Anda (HMAC). Tanpa token, tidak ada keputusan yang dianggap sah.
- **Peringatan terbuka (FIX-G2-01b):** belum terbukti agent `codex_local` tidak bisa membaca `.env`. Sebelum menjalankan agent LLM nyata, putuskan lokasi token di luar jangkauan agent (lihat `reports/review/G2-review.md`).

## 4. Menjalankan satu carousel

Alur penuh agent LLM nyata **belum terbukti** (E1.2, menunggu keputusan O-004 di `loop/OWNER-QUEUE.md`). Orkestrasi antar-agent juga belum ada: setelah satu agent selesai, issue belum otomatis pindah ke agent berikutnya. Sampai itu selesai, jalankan satu tahap per run dari UI Paperclip secara manual. **[belum teruji dengan agent nyata]**

Batas pemakaian per agent per hari ada di `divisions\edukasiai\limits.json` (default 6 run dan 60 menit); agent yang mencapai batas dipause otomatis oleh guard.

## 5. Meninjau, approve, reject

Paket yang siap ditinjau berstatus **in_review** dan punya dokumen `handoff`. Lihat:
- teks: dokumen `carousel` pada issue (UI Paperclip atau Office Console);
- gambar: `workspace\issues\<issueId>\render\slide-NN.png` dan `contact-sheet.png`.

Keputusan (hanya jika issue in_review, ada `handoff` dari QA, dan isi paket tidak berubah sejak handoff):

```powershell
node scripts\owner-decide.mjs approve --issue <issueId>                    # [teruji dengan klien tiruan]
node scripts\owner-decide.mjs reject  --issue <issueId> --note "alasan"    # catatan WAJIB; kembali ke Copywriter
```

- Approve menulis record bertanda tangan di `output\approvals\<issueId>\` dan menyetel issue `done`.
- Reject mengembalikan issue ke Copywriter dengan catatan Anda sebagai komentar.
- Bila Paperclip gagal di tengah (komentar/status), jalankan **perintah yang sama lagi**: record yang sama dipakai ulang, tidak ada record ganda.
- **[belum teruji]** terhadap Paperclip nyata: klien HTTP `owner-decide` baru diuji dengan klien tiruan (menunggu issue in_review nyata dari E1.2).

## 6. Menyiapkan paket publikasi

Setelah approve (issue `done`):

```powershell
node scripts\prepare-publication.mjs --issue <issueId>
```

Hasil: `output\edukasiai\<tanggal>-<slug>\` berisi `slide-NN.png`, `slides.md`, `caption.txt`, `sources.md`, `meta.json`. Dijalankan dua kali tetap satu folder **[teruji]**. Penolakan (tanpa approval, hash berubah, issue belum done) tercatat di `output\audit.log`; satu penolakan nyata terdokumentasi di `docs/evidence/H3.3/prepare-refused-live.txt`.

**Posting ke media sosial dilakukan manual oleh Anda.** Tidak ada posting otomatis dan tidak ada `git push` dari proyek ini.

## 7. Memulihkan run yang gagal

1. Lihat penyebab: UI Paperclip (halaman run) atau Office View (karakter di Pojok Bug 🐞).
2. Agent berstatus `error`: pulihkan dengan resume dari UI Paperclip, atau `POST /api/agents/<id>/resume` **[teruji, `scripts/office-live-recover.mjs`]**.
3. Agent dipause oleh guard pemakaian: periksa batas di `limits.json`; resume dari UI setelah Anda yakin.
4. Draf setengah jadi tidak pernah dianggap lolos: QA, handoff, dan approve semuanya dihitung ulang dari isi nyata, jadi cukup jalankan ulang tahap yang gagal.
5. Render gagal: jalankan ulang `render_carousel`; laporan render lama tidak diwarisi (teruji).
6. Isu yang diketahui: satu run nyata gagal `setup_failed` (bash `node -e ...` gagal ±24 detik saat CPU padat). Penyebab belum terbukti; selidiki sebelum E1.2 (`reports/build/U4.L.md`).
7. Jangan menghapus folder output dengan `rmdir`: di Windows bisa gagal `EBUSY`. Kosongkan isinya saja.

## 8. Routine harian dan burn-in

Routine Senin–Jumat 07.00 WIB **dibuat nonaktif**. Pasang (belum aktif), lalu aktifkan saat siap burn-in:

```powershell
node scripts\install-routine.mjs             # pasang, paused + trigger nonaktif   [teruji dengan klien tiruan]
node scripts\install-routine.mjs --enable    # aktifkan (Anda)
node scripts\install-routine.mjs --disable   # matikan lagi
```

Prasyarat sebelum `--enable`: E1.2 lulus, FIX-G2-01b dan FIX-G1-04/05/07/10 selesai, dan Anda siap kuota langganan Codex terpakai tiap pagi. Perilaku `skip_if_active` (pemicu ganda → satu issue) **[belum teruji di server nyata]**.

Laporan KPI mingguan (hanya membaca):

```powershell
node scripts\kpi-report.mjs                  # reports\kpi\kpi-YYYY-Www.md   [teruji]
```

Target MVP: 5 draf/minggu selama 2 minggu berturut-turut. "BELUM ADA DATA" di laporan berarti belum terukur, bukan lulus.

## 9. Upgrade Paperclip dengan aman

Upgrade adalah **task terpisah dengan regression test** (CLAUDE.md aturan 7); jangan `git pull`/upgrade sambil mengerjakan hal lain. **[belum teruji]**

1. Catat versi sekarang (`docs/versions.md`: `paperclipai@2026.1001.0`). Selalu tulis versi eksplisit di perintah `npx`.
2. Hentikan server (`-Stop`), cadangkan folder instance `%USERPROFILE%\.paperclip\instances\default` (termasuk `secrets\master.key`).
3. Naikkan versi di satu tempat (`scripts\start-paperclip.ps1` dan `docs/versions.md`), jalankan server.
4. Regresi: `node scripts\smoke-test.mjs`, `npm test`, `node scripts\install-division.mjs` (harus tetap 5 agent), lalu ulangi AC1.2 bila E1.2 sudah lulus.
5. Bila ada yang gagal: kembalikan versi lama dan cadangan; catat di `loop/DECISIONS.md`. Jangan mengubah kode Paperclip (ADR-0001).

## 10. Keamanan harian

- `npm run secret-scan` memindai berkas dan seluruh riwayat git **[teruji, 0 temuan]**.
- Jangan membuka, mengubah, atau menghapus company `Office Mega Class` (bukan milik loop).
- `master.key` Paperclip hanya terbaca akun Farrel, SYSTEM, Administrators; agent berjalan sebagai akun yang sama (risiko tercatat di `reports/build/H3.2.md`).

## 10b. Menjalankan tes dengan benar

`npm test` memuat tes yang menjalankan Chromium sungguhan (render). Jalankan pada mesin yang tidak sibuk: proses lain yang memakan CPU membuat tes render melewati batas waktu. Pada run bersih (H3.3) satu suite penuh memerlukan sekitar 4 menit. Bila ada kegagalan "timeout" pada `render-tool`, `handoff`, atau `qa-deterministic`, cek beban CPU lebih dulu lalu jalankan ulang file itu saja:

```powershell
npx vitest run testsender-tool.test.mjs
```

## 11. Status proyek dan loop

```powershell
node scripts\loop-status.js        # status dan task berikutnya
```

Item yang menunggu Anda ada di `loop\OWNER-QUEUE.md` (O-002 hapus sisa hook, O-004 izin run LLM nyata, O-005 pasang routine, O-006 sumber tanggal terbit).
