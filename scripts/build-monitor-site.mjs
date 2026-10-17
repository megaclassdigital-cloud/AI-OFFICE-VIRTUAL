#!/usr/bin/env node
// build-monitor-site.mjs — menyalin frontend Office View (apps/office-view/public) ke vercel-monitor/public supaya proyek Vercel (Root Directory = vercel-monitor)
// berdiri sendiri. Frontend SAMA dengan desktop; bedanya hanya sumber data (API monitor). Jalankan ulang setiap frontend berubah; tes memastikan salinan sinkron.
// Pemakaian: node scripts/build-monitor-site.mjs [--check]   (--check: keluar 1 bila salinan tidak sinkron)
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SRC = path.join(ROOT, 'apps', 'office-view', 'public');
export const DST = path.join(ROOT, 'vercel-monitor', 'public');

export function treeHash(dir) {
  const out = [];
  const walk = (d, rel) => { for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const p = path.join(d, e.name); const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) walk(p, r); else out.push(`${r}:${crypto.createHash('sha1').update(readFileSync(p)).digest('hex')}`); } };
  if (existsSync(dir)) walk(dir, '');
  return out.join('\n');
}
export const inSync = () => treeHash(SRC) === treeHash(DST);

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) { const ok = inSync(); console.log(ok ? 'vercel-monitor/public sinkron' : 'vercel-monitor/public TIDAK sinkron: jalankan node scripts/build-monitor-site.mjs'); process.exit(ok ? 0 : 1); }
  if (existsSync(DST)) for (const e of readdirSync(DST)) rmSync(path.join(DST, e), { recursive: true, force: true }); // kosongkan isinya, bukan foldernya (Windows: EBUSY)
  mkdirSync(DST, { recursive: true }); cpSync(SRC, DST, { recursive: true });
  const n = treeHash(DST).split('\n').length; console.log(`disalin ${n} berkas ke vercel-monitor/public`); void statSync;
}
