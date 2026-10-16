#!/usr/bin/env node
// run-index.mjs — satu tempat untuk membaca riwayat sebuah konten: versi (asli + revisi), putaran QA beserta catatannya, status aset gambar.
// Dibuat KODE dari berkas yang ada (tanpa LLM, tanpa Paperclip), deterministik: isi yang sama menghasilkan teks yang sama (tanpa cap waktu), sehingga
// aman dipanggil berulang dan hanya menulis bila isinya berubah.
//   runs/<EDU-n>/RIWAYAT.md   riwayat satu konten (kode konten TIDAK berubah; nomor issue Paperclip hanya internal)
//   runs/INDEX.md             daftar semua konten
// Pemakaian: node scripts/run-index.mjs [--content EDU-97] [--outputs <folder workspace/agent>]
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTENT_RE, labelOf, listRevisions, masterIdentifierOf, readRunMeta, runDirOf, runKeyFor } from './run-registry.mjs';

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, '')); } catch { return null; } };
const dirs = (p) => { try { return readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); } catch { return []; } };
const files = (p) => { try { return readdirSync(p); } catch { return []; } };
const tgl = (ms) => (ms ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '-');
const mtime = (p) => { try { return statSync(p).mtimeMs; } catch { return 0; } };

/** Ringkasan satu putaran QA dari qa-result.json. */
export function qaSummary(q) {
  if (!q) return null;
  const notes = (Array.isArray(q.notes) ? q.notes : [q.notes]).filter(Boolean).map((n) => String(n).replace(/\s+/g, ' ').slice(0, 400));
  return { passed: q.passed === true, returnTo: [].concat(q.returnTo ?? []), fromScratch: q.fromScratch === true, designReview: q.designReview ?? null, notes };
}

/** Kumpulkan fakta satu versi (asli atau revisi) dari berkasnya. */
export function versionFacts(outputs, contentId, rev) {
  const runKey = runKeyFor(contentId, rev);
  const dir = runDirOf(outputs, runKey);
  const meta = readRunMeta(outputs, runKey);
  const master = masterIdentifierOf(outputs, runKey);
  const order = readJson(path.join(outputs, 'orders', `${master}.json`)) ?? readJson(path.join(outputs, 'orders', `${contentId}.json`));
  const carousel = readJson(path.join(dir, 'carousel.json'));
  const render = files(path.join(dir, 'render')).filter((f) => /^slide-[0-9]+[.]png$/.test(f)).length;
  const vq = readJson(path.join(dir, 'render', 'visual-qa.json'));
  const manifest = readJson(path.join(dir, 'assets-manifest.json'));
  const hold = readJson(path.join(dir, 'assets-hold.json'));
  const qaNow = qaSummary(readJson(path.join(dir, 'qa-result.json.accepted')) ?? readJson(path.join(dir, 'qa-result.json')));
  const rounds = dirs(path.join(dir, 'arsip')).map((name) => ({ name, qa: qaSummary(readJson(path.join(dir, 'arsip', name, 'qa-result.json'))) })).filter((r) => r.qa);
  const assets = (manifest?.assets ?? []).reduce((a, x) => { a[x.status] = (a[x.status] ?? 0) + 1; return a; }, {});
  return {
    rev, runKey, label: labelOf(runKey), dir, master, startStage: meta?.startStage ?? (rev === 0 ? 'researcher' : null), createdAt: meta?.createdAt ?? null,
    title: order?.title ?? carousel?.topic ?? null, slides: carousel?.slides?.length ?? 0, render, visualQa: vq ? vq.passed === true : null,
    assets, missing: (hold?.missing ?? []).map((m) => m.file), qaNow, rounds,
    has: { research: existsSync(path.join(dir, 'research-output.json')), verification: existsSync(path.join(dir, 'verification-result.json')), carousel: !!carousel, design: existsSync(path.join(dir, 'carousel-design.json')) },
    updatedMs: Math.max(mtime(path.join(dir, 'carousel-design.json')), mtime(path.join(dir, 'carousel.json')), mtime(path.join(dir, 'qa-result.json')), mtime(path.join(dir, 'render', 'visual-qa.json'))),
  };
}

const qaLine = (q) => (q.passed ? 'lolos' : `ditolak${q.fromScratch ? ', diminta dibuat dari awal' : q.returnTo.length ? ` → revisi ke ${q.returnTo.join(', ')}` : ''}`);

/** Teks RIWAYAT.md satu konten. */
export function renderHistory(contentId, versions) {
  const latest = versions[versions.length - 1];
  const L = [];
  L.push(`# ${contentId} — ${versions[0]?.title ?? latest?.title ?? '(tanpa judul)'}`, '');
  L.push(`Kode konten **${contentId}** tetap sama untuk semua revisi dan percobaan ulang. Nomor issue Paperclip yang muncul di log atau papan (mis. nomor master revisi) hanya INTERNAL.`, '');
  L.push('## Versi', '', '| Versi | Folder | Mulai dari tahap | Nomor master (internal) | Slide | Render | QA terakhir |', '| --- | --- | --- | --- | --- | --- | --- |');
  for (const v of versions) {
    const folder = v.rev === 0 ? `runs/${contentId}/` : `runs/${contentId}/revision-${v.rev}/`;
    L.push(`| ${v.rev === 0 ? 'asli' : `revisi ${v.rev}`} | \`${folder}\` | ${v.startStage ?? '-'} | ${v.master !== contentId ? v.master : '-'} | ${v.slides || '-'} | ${v.render ? `${v.render} PNG${v.visualQa === false ? ' (visual-qa GAGAL)' : ''}` : 'belum'} | ${v.qaNow ? qaLine(v.qaNow) : 'belum'} |`);
  }
  L.push('');
  for (const v of versions) {
    if (!v.rounds.length && !v.qaNow && !v.missing.length && !Object.keys(v.assets).length) continue;
    L.push(`## ${v.rev === 0 ? 'Versi asli' : `Revisi ${v.rev}`}`, '');
    if (Object.keys(v.assets).length) L.push(`- Aset gambar: ${Object.entries(v.assets).map(([k, n]) => `${n} ${k}`).join(', ')}.`);
    if (v.missing.length) L.push(`- **Ditahan menunggu gambar asli:** ${v.missing.join(', ')} (taruh di \`workspace/inbox/assets/${v.runKey}/\` atau selesaikan CAPTCHA lewat \`node scripts/browser-login.mjs\`).`);
    if (v.rounds.length) {
      L.push('', '### Putaran QA yang sudah diarsipkan');
      for (const r of v.rounds) {
        L.push('', `**${r.name}**: ${qaLine(r.qa)}`);
        for (const n of r.qa.notes.slice(0, 6)) L.push(`- ${n}`);
      }
    }
    if (v.qaNow) {
      L.push('', '### QA versi ini (terbaru)', '', `**${qaLine(v.qaNow)}**`);
      for (const n of v.qaNow.notes.slice(0, 6)) L.push(`- ${n}`);
    }
    L.push('');
  }
  L.push('## Tata letak folder', '', '- `research-*.json`, `verification-result.json`, `carousel.json`, `carousel-design.json`, `assets/`, `render/`, `qa-result.json`: hasil TERBARU versi ini.',
    '- `arsip/qa-putaran-N-*/`: hasil lama yang diganti saat QA meminta revisi (dipindah, tidak dihapus).', '- `_sisa-alat/`: sisa berkas bantu agen (parameter tool, skrip sementara); aman diabaikan.');
  return L.join('\n') + '\n';
}

export function renderGlobalIndex(rows) {
  const L = ['# Indeks konten', '', 'Dibuat otomatis oleh `scripts/run-index.mjs`. Satu baris per konten; kode konten tidak berubah walau ada revisi.', '',
    '| Konten | Judul | Versi | Versi terbaru | Render | QA terbaru | Riwayat |', '| --- | --- | --- | --- | --- | --- | --- |'];
  for (const r of rows) L.push(`| ${r.contentId} | ${String(r.title ?? '').replace(/\|/g, '/').slice(0, 70)} | ${r.count} | ${r.latest.label} | ${r.latest.render ? `${r.latest.render} PNG` : 'belum'} | ${r.latest.qaNow ? qaLine(r.latest.qaNow) : 'belum'} | [RIWAYAT](${r.contentId}/RIWAYAT.md) |`);
  return L.join('\n') + '\n';
}

const writeIfChanged = (file, text) => { try { if (readFileSync(file, 'utf8') === text) return false; } catch { /* belum ada */ } writeFileSync(file, text); return true; };

/** Tulis RIWAYAT.md satu konten (dan indeks global). Mengembalikan true bila ada berkas yang berubah. */
export function writeContentHistory(outputs, contentId, { index = true } = {}) {
  if (!CONTENT_RE.test(contentId)) return false;
  const base = runDirOf(outputs, contentId);
  if (!existsSync(base)) return false;
  const versions = [0, ...listRevisions(outputs, contentId)].map((n) => versionFacts(outputs, contentId, n));
  let changed = writeIfChanged(path.join(base, 'RIWAYAT.md'), renderHistory(contentId, versions));
  if (index) changed = writeGlobalIndex(outputs) || changed;
  return changed;
}

export function writeGlobalIndex(outputs) {
  const root = path.join(outputs, 'runs');
  const rows = dirs(root).filter((d) => CONTENT_RE.test(d)).sort((a, b) => Number(b.slice(4)) - Number(a.slice(4))).map((contentId) => {
    const versions = [0, ...listRevisions(outputs, contentId)].map((n) => versionFacts(outputs, contentId, n));
    return { contentId, title: versions[0].title ?? versions[versions.length - 1].title, count: versions.length, latest: versions[versions.length - 1] };
  });
  return writeIfChanged(path.join(root, 'INDEX.md'), renderGlobalIndex(rows));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const arg = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
  const outputs = path.resolve(arg('--outputs', path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'workspace', 'agent')));
  const only = arg('--content', null);
  const list = only ? [only] : dirs(path.join(outputs, 'runs')).filter((d) => CONTENT_RE.test(d));
  let n = 0;
  for (const c of list) if (writeContentHistory(outputs, c, { index: false })) n++;
  writeGlobalIndex(outputs);
  console.log(`riwayat diperbarui untuk ${n} dari ${list.length} konten; indeks: ${path.join(outputs, 'runs', 'INDEX.md')}`);
}
