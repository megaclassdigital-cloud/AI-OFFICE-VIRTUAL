#!/usr/bin/env node
// setup-monitor.mjs — membuat rahasia monitor kedua. Nilainya TIDAK dicetak ke layar/obrolan:
//   .env (laptop, gitignored)                     : MIRROR_INGEST_SECRET (+ MIRROR_URL setelah proyek Vercel ada)
//   vercel-monitor/ENV-UNTUK-VERCEL.txt (gitignored): blok yang ditempel owner ke Vercel > Settings > Environment Variables
//                                                     MIRROR_INGEST_SECRET, MIRROR_REVIEW_KEY, MIRROR_SESSION_SECRET
// Pemakaian: node scripts/setup-monitor.mjs [--url https://proyek.vercel.app] [--rotate-review-key] [--rotate-secret]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newSecret, newReviewKey } from '../apps/office-view/access.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV = path.join(ROOT, '.env'); const OUT = path.join(ROOT, 'vercel-monitor', 'ENV-UNTUK-VERCEL.txt');
const a = process.argv.slice(2);
const lines = existsSync(ENV) ? readFileSync(ENV, 'utf8').replace(/^﻿/, '').split(/\r?\n/) : [];
const get = (k) => (lines.find((l) => l.startsWith(`${k}=`)) ?? '').slice(k.length + 1) || null;
const set = (k, v) => { const i = lines.findIndex((l) => l.startsWith(`${k}=`)); if (i >= 0) lines[i] = `${k}=${v}`; else lines.push(`${k}=${v}`); };

const changed = [];
if (!get('MIRROR_INGEST_SECRET')) { set('MIRROR_INGEST_SECRET', newSecret()); changed.push('MIRROR_INGEST_SECRET'); }
if (!get('MIRROR_REVIEW_KEY') || a.includes('--rotate-review-key')) { set('MIRROR_REVIEW_KEY', newReviewKey()); changed.push('MIRROR_REVIEW_KEY'); }
if (!get('MIRROR_SESSION_SECRET') || a.includes('--rotate-secret')) { set('MIRROR_SESSION_SECRET', newSecret()); changed.push('MIRROR_SESSION_SECRET'); }
if (a.includes('--url')) { const u = a[a.indexOf('--url') + 1]; if (!/^https:\/\/[A-Za-z0-9.-]+$/.test(u ?? '')) { console.error('--url harus berbentuk https://nama.vercel.app'); process.exit(1); } set('MIRROR_URL', u); changed.push('MIRROR_URL'); }
writeFileSync(ENV, lines.join('\n').replace(/\n*$/, '\n'), 'utf8');
writeFileSync(OUT, [
  '# Tempel tiga baris ini di Vercel > Project > Settings > Environment Variables (Production), lalu Redeploy. Jangan dibagikan.',
  `MIRROR_INGEST_SECRET=${get('MIRROR_INGEST_SECRET')}`,
  `MIRROR_REVIEW_KEY=${get('MIRROR_REVIEW_KEY')}`,
  `MIRROR_SESSION_SECRET=${get('MIRROR_SESSION_SECRET')}`,
  '# Blob store: buat di Vercel > Storage > Create > Blob (PRIVATE), hubungkan ke proyek ini; BLOB_READ_WRITE_TOKEN ditambahkan Vercel otomatis.',
  '',
].join('\n'), 'utf8');
console.log(changed.length ? `Diperbarui di .env: ${changed.join(', ')}` : 'Semua rahasia sudah ada (tidak diubah).');
console.log(`Blok untuk Vercel ada di: ${path.relative(ROOT, OUT)} (tidak dicetak di sini). Tautan monitor: <alamat-vercel>/review?key=<MIRROR_REVIEW_KEY dari .env>`);
