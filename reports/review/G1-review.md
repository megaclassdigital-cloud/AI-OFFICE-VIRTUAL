# Review gate G1 — Fase 1 (fondasi, pipeline, QA, handoff)

- Tanggal: 2026-10-08
- Reviewer: subagent independen (agent umum, konteks bersih), berpedoman pada `loop/REVIEWER.md`.
- Yang dijalankan implementer sebelum review: `npm test` 231/231, `node scripts/smoke-test.mjs` 37/37.
- Yang dijalankan reviewer sendiri: `npm test` 231/231, `loop-status --check` valid, pindai secret, `git status`, pemeriksaan remote/push.

## Ringkasan verdict

**PASS WITH CONCERNS.** Batas FAIL: bila FIX-G1-01 s.d. FIX-G1-03 tidak selesai sebelum F2.1, verdict menjadi FAIL.

## Temuan utama (ringkas dari laporan reviewer)

| Fix | Masalah | Syarat |
| --- | --- | --- |
| FIX-G1-01 | `verification-result` ditulis agent lewat `attach_file`; QA memercayai `status:"verified"` tanpa bukti bahwa `verify_candidate` pernah dipanggil | sebelum F2.1 |
| FIX-G1-02 | Hash paket memakai `hashes.json` dari disk; PNG slide yang diganti setelah render tidak terdeteksi (hanya contact sheet yang di-hash ulang) | sebelum F2.1 |
| FIX-G1-03 | Laporan render tidak terikat ke dokumen `carousel-design`; `visual-qa.json`/`hashes.json` bisa ditulis agent | sebelum F2.1 |
| FIX-G1-04 | SSRF: `isPrivateHost` meloloskan `::ffff:127.0.0.1`, `[::]`, `100.64.0.0/10`, dan tidak ada pemeriksaan DNS rebinding | sebelum E1.2 |
| FIX-G1-05 | `qa_submit_result`, `handoff_to_owner`, `render_carousel` tidak dibatasi peran agent | sebelum E1.2 |
| FIX-G1-06 | Cek angka dilewati bila `research-output` tidak ada | sebelum F2.1 |
| FIX-G1-07 | Belum terbukti API Paperclip menolak `done` dari kredensial agent (hanya lewat tool plugin) | sebelum E1.2 |
| FIX-G1-08 | Logika EdukasiAI bocor ke plugin (D-010): QA tidak diparameterisasi per division | sebelum division kedua |
| FIX-G1-09 | `isInside` memakai `path.resolve` bukan `realpath`; key dokumen `handoff` bisa ditimpa agent | rendah |
| FIX-G1-10 | Kebijakan kandidat 403 (D-009) belum diputuskan | sebelum E1.2 |

Yang berjalan baik menurut reviewer: jalur tulis agent sempit (agent tidak bisa mencapai `done`/`cancelled`, tidak ada tool approve/publish), routing QA dengan LLM hanya menambah kegagalan, handoff terikat hash isi, `render-tool` (UUID, regex, folder terkunci, tanpa shell), `url-check` (https, redirect per lompatan, isi halaman tidak dikembalikan), bukti nyata di `docs/evidence/`, dan pencatatan jujur E1.2 sebagai OWNER.

## Tanggapan implementer

- Seluruh temuan diterima; tidak ada yang dibantah. Temuan 1–3 tepat: "agent tidak bisa menyodorkan laporan palsu" di laporan F1.9b melebihi bukti, dan pernyataan itu dikoreksi di sini: yang terbukti hanyalah bahwa LLM tidak bisa meloloskan draf yang gagal cek kode; keabsahan dokumen masukan belum terikat.
- Rencana: FIX-G1-01, -02, -03, -06 dikerjakan sebagai bagian awal Fase 2 (sebelum F2.1); FIX-G1-04, -05, -07, -10 sebelum E1.2; FIX-G1-08 sebelum division kedua; FIX-G1-09 bersama FIX-G1-02.
- F2.1 dan E1.2 TIDAK dimulai sebelum syarat masing-masing terpenuhi.
