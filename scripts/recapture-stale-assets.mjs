#!/usr/bin/env node
// recapture-stale-assets.mjs — menandai aset yang CATATAN MANIFESTNYA basi supaya capture-asset mengambilnya ulang (tanpa mengulang agen).
// Kasus: Designer sudah memperbaiki asset-requests.json (mis. kind photo -> brand), tetapi assets-manifest.json masih mencatat gambar lama bertipe photo yang
// dipertahankan ("kept"), sehingga gerbang aset menolak terus. Skrip ini hanya membuang entri manifest untuk berkas yang jenisnya TIDAK cocok dengan permintaan
// terbaru; berkas lain tetap. Pemakaian: node scripts/recapture-stale-assets.mjs EDU-117   (lalu jalankan: node scripts/capture-asset.mjs --issue EDU-117)
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJ = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, ''));

/** Murni: daftar berkas manifest yang basi terhadap permintaan terbaru (kind berbeda, atau merek berbeda untuk kind brand). */
export function staleFiles(requests, manifest) {
  const want = new Map((requests?.requests ?? []).map((r) => [r.file, r]));
  const stale = [];
  for (const a of manifest?.assets ?? []) {
    const r = want.get(a.file);
    if (!r || a.status === 'owner-supplied') continue;
    if ((a.kind && r.kind && a.kind !== r.kind) || (r.kind === 'brand' && a.brand && r.brand && String(a.brand).toLowerCase() !== String(r.brand).toLowerCase())) stale.push(a.file);
  }
  return stale;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const id = process.argv.slice(2).find((x) => /^EDU-[0-9]+/.test(x));
  if (!id) { console.error('Pakai: node scripts/recapture-stale-assets.mjs EDU-n'); process.exit(1); }
  const dir = path.join(ROOT, 'workspace', 'agent', 'runs', ...id.split('/'));
  const reqs = readJ(path.join(dir, 'asset-requests.json')); const manPath = path.join(dir, 'assets-manifest.json'); const man = readJ(manPath);
  const stale = staleFiles(reqs, man);
  if (!stale.length) { console.log('tidak ada entri manifest yang basi'); process.exit(0); }
  copyFileSync(manPath, manPath + '.bak-basi');
  man.assets = man.assets.filter((a) => !stale.includes(a.file));
  man.complete = false;
  writeFileSync(manPath, JSON.stringify(man, null, 2) + '\n');
  console.log(`entri manifest basi dibuang (akan diambil ulang): ${stale.join(', ')}`);
}
