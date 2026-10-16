// owner-override.mjs — keputusan OWNER yang menggantikan penolakan QA (bukan mengubah hasil QA).
// Prinsip: LLM tidak memegang otoritas final atas approval, tetapi owner memegangnya. Bila QA menolak (mis. soal komposisi) dan owner memutuskan menerima
// konten apa adanya, keputusan itu dicatat di owner-override.json TERIKAT pada isi qa-result.json yang ditolak (hash). Bila QA menulis hasil baru, hash
// berbeda dan override gugur otomatis. Hasil QA asli TIDAK diubah; cek deterministik (render, aset, tanggal, URL) tetap dijalankan oleh kode finalisasi.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const FILE = 'owner-override.json';
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const qaFileIn = (dir) => ['qa-result.json.accepted', 'qa-result.json'].map((f) => path.join(dir, f)).find((f) => existsSync(f)) ?? null;

/** Tulis keputusan owner untuk hasil QA yang sekarang ada di folder run. Menolak bila QA tidak menolak atau tidak ada hasil QA. */
export function writeOverride(dir, { note = '', nowMs = Date.now() } = {}) {
  const qaFile = qaFileIn(dir);
  if (!qaFile) throw new Error('tidak ada qa-result.json: tidak ada penolakan QA yang bisa diterima owner');
  const raw = readFileSync(qaFile);
  const qa = JSON.parse(raw.toString('utf8').replace(/^﻿/, ''));
  if (qa.passed === true) throw new Error('QA tidak menolak; override tidak diperlukan');
  const rec = {
    accepted: true, by: 'owner', acceptedAt: new Date(nowMs).toISOString(), note: String(note).slice(0, 600),
    qaFile: path.basename(qaFile), qaSha256: sha(raw),
    qa: { passed: false, returnTo: [].concat(qa.returnTo ?? []), designReview: qa.designReview ?? null, llmReview: qa.llmReview ?? null, notes: (Array.isArray(qa.notes) ? qa.notes : [qa.notes]).filter(Boolean).map((n) => String(n).slice(0, 300)).slice(0, 8) },
  };
  writeFileSync(path.join(dir, FILE), JSON.stringify(rec, null, 2) + '\n');
  return rec;
}

/** Override yang MASIH sah (hash cocok dengan hasil QA saat ini), atau null. */
export function readValidOverride(dir) {
  const f = path.join(dir, FILE);
  if (!existsSync(f)) return null;
  try {
    const rec = JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, ''));
    const qaFile = qaFileIn(dir);
    if (!rec?.accepted || !qaFile || sha(readFileSync(qaFile)) !== rec.qaSha256) return null;
    return rec;
  } catch { return null; }
}

/** Penilaian yang dikirim ke qa_submit_result: owner menerima komposisi/desain yang ditolak; penilaian teks QA tidak diubah. */
export function llmWithOverride(llm, override) {
  return override ? { ...llm, designOk: true } : llm;
}

/** Teks catatan audit untuk issue produksi. */
export function overrideComment(rec) {
  return `[Keputusan owner] Konten diterima apa adanya walau QA menolak (${rec.acceptedAt}).${rec.note ? ` Catatan owner: ${rec.note}` : ''}\n` +
    `Temuan QA yang diterima owner:\n${rec.qa.notes.map((n) => `- ${n}`).join('\n')}\n` +
    'Cek deterministik (render, aset, tanggal, URL) tetap dijalankan kode. Hasil QA asli tidak diubah.';
}
