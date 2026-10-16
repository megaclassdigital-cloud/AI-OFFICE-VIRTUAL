#!/usr/bin/env node
// tidy-workspace.mjs — merapikan sisa berkas bantu agen tanpa menghapus apa pun: dipindah ke _sisa-alat/ (bisa dikembalikan).
// Yang dianggap sisa: berkas parameter tool dan skrip sementara yang ditulis agen untuk memanggil tool (tidak dibaca kode mana pun).
// Hasil kerja sungguhan (carousel.json, carousel-design.json, assets/, render/, qa-result.json, dst.) TIDAK PERNAH disentuh.
// Pemakaian: node scripts/tidy-workspace.mjs            (hanya menampilkan rencana)
//            node scripts/tidy-workspace.mjs --apply    (memindahkan)
import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTENT_RE, listRevisions, runDirOf, runKeyFor } from './run-registry.mjs';

/** Nama berkas sisa di dalam folder run (verifikasi: tidak dirujuk kode mana pun). */
export const RUN_LEFTOVERS = ['make-attach.mjs', 'attach-payload.json', 'status-patch.json', 'attach-params.json', 'render-params.json'];
/** Berkas sisa di akar workspace/agent. */
export const ROOT_LEFTOVERS = ['attach-carousel-params-string.json', 'attach-carousel-params.json', 'complete-stage-params.json'];
export const LEFTOVER_DIR = '_sisa-alat';

/** Rencana pemindahan: [{from, to}] untuk folder `outputs` (= workspace/agent). Murni baca. */
export function planTidy(outputs) {
  const plan = [];
  const add = (dir, names) => { for (const n of names) { const from = path.join(dir, n); if (existsSync(from)) plan.push({ from, to: path.join(dir, LEFTOVER_DIR, n) }); } };
  add(outputs, ROOT_LEFTOVERS);
  const runs = path.join(outputs, 'runs');
  if (existsSync(runs)) {
    for (const e of readdirSync(runs, { withFileTypes: true })) {
      if (!e.isDirectory() || !CONTENT_RE.test(e.name)) continue;
      for (const n of [0, ...listRevisions(outputs, e.name)]) add(runDirOf(outputs, runKeyFor(e.name, n)), RUN_LEFTOVERS);
    }
  }
  return plan;
}

/** Jalankan rencana. Tidak menimpa: bila tujuan sudah ada, berkas diberi akhiran waktu. */
export function applyTidy(plan) {
  let moved = 0;
  for (const { from, to } of plan) {
    mkdirSync(path.dirname(to), { recursive: true });
    const dest = existsSync(to) ? `${to}.${Date.now()}` : to;
    renameSync(from, dest); moved++;
  }
  return moved;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const outputs = path.resolve(a.includes('--outputs') ? a[a.indexOf('--outputs') + 1] : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'workspace', 'agent'));
  const plan = planTidy(outputs);
  if (!plan.length) { console.log('Tidak ada sisa berkas yang perlu dirapikan.'); process.exit(0); }
  for (const p of plan) console.log(`${a.includes('--apply') ? 'pindah' : 'rencana'}: ${path.relative(outputs, p.from)}  ->  ${path.relative(outputs, p.to)}`);
  if (a.includes('--apply')) console.log(`${applyTidy(plan)} berkas dipindah ke ${LEFTOVER_DIR}/ (tidak ada yang dihapus).`);
  else console.log(`\n${plan.length} berkas akan dipindah. Jalankan dengan --apply untuk memindahkan.`);
}
