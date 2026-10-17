#!/usr/bin/env node
// setup-review-access.mjs — membuat rahasia akses mode REVIEW (hanya-baca untuk klien) di .env (tidak pernah di repo).
//   AAO_SESSION_SECRET : penanda tangan cookie sesi (dibuat sekali, tidak ditampilkan)
//   AAO_REVIEW_KEY     : kunci tautan review (ditampilkan; berikan ke klien lewat tautan /review?key=...)
// Pemakaian: node scripts/setup-review-access.mjs [--rotate-review-key] [--show] [--base https://alamat-publik]
//   tanpa flag: membuat yang belum ada. --rotate-review-key: kunci baru (tautan lama langsung mati; sesi review lama tetap sah sampai habis, ganti juga secret dengan --rotate-secret untuk mematikan semuanya).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newSecret, newReviewKey } from '../apps/office-view/access.mjs';

const ENV = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), '.env');
const a = process.argv.slice(2);
const lines = existsSync(ENV) ? readFileSync(ENV, 'utf8').split(/\r?\n/) : [];
const get = (k) => (lines.find((l) => l.startsWith(`${k}=`)) ?? '').slice(k.length + 1) || null;
const set = (k, v) => { const i = lines.findIndex((l) => l.startsWith(`${k}=`)); if (i >= 0) lines[i] = `${k}=${v}`; else lines.push(`${k}=${v}`); };

let changed = [];
if (!get('AAO_SESSION_SECRET') || a.includes('--rotate-secret')) { set('AAO_SESSION_SECRET', newSecret()); changed.push('AAO_SESSION_SECRET'); }
if (!get('AAO_REVIEW_KEY') || a.includes('--rotate-review-key')) { set('AAO_REVIEW_KEY', newReviewKey()); changed.push('AAO_REVIEW_KEY'); }
if (changed.length) writeFileSync(ENV, lines.filter((l, i, arr) => l !== '' || i < arr.length - 1).join('\n').replace(/\n*$/, '\n'), 'utf8');

console.log(changed.length ? `Dibuat/diperbarui di .env: ${changed.join(', ')}` : 'Rahasia review sudah ada di .env (tidak diubah).');
if (changed.includes('AAO_REVIEW_KEY') || a.includes('--show')) {
  const base = (a.includes('--base') ? a[a.indexOf('--base') + 1] : 'https://ALAMAT-PUBLIK').replace(/\/$/, '');
  console.log(`Tautan review untuk klien (rahasiakan; hanya-baca):\n  ${base}/review?key=${get('AAO_REVIEW_KEY')}`);
}
