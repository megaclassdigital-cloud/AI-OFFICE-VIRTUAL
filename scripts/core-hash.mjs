#!/usr/bin/env node
// core-hash.mjs — sidik jari ISI berkas core Paperclip yang terpasang (bukan mtime).
//
// Tujuan: bukti yang bisa diulang bahwa core Paperclip tidak kita ubah (ADR-0001, AC0.4).
// PRD meminta "git status repo Paperclip bersih", tetapi Paperclip kita dipasang lewat cache npx,
// bukan git checkout. Penggantinya: SHA-256 atas isi setiap berkas paket `paperclipai` dan
// `@paperclipai/*` (tanpa node_modules bersarang), lalu satu hash gabungan.
//
// Pemakaian:
//   node scripts/core-hash.mjs                 # cetak ringkasan
//   node scripts/core-hash.mjs --write <path>  # tulis baseline JSON
//   node scripts/core-hash.mjs --check <path>  # bandingkan dengan baseline; exit 1 bila beda
//
// Batasan jujur: baseline pertama dibuat SESUDAH plugin dipasang (F0.4), jadi ia membuktikan
// "tidak berubah sejak baseline", bukan "tidak berubah sejak sebelum plugin". Bukti pra-plugin
// hanya berupa hash manifest (nama+ukuran+mtime) di docs/spike/evidence/F0.4-plugin-tool-proof.txt
// dan fakta bahwa tidak ada berkas core lebih baru daripada waktu instalasi paketnya.

import { readdirSync, readFileSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import path from 'node:path';

const PINNED = '2026.1001.0';

function npmCache() {
  if (process.env.AAO_NPM_CACHE) return process.env.AAO_NPM_CACHE;
  return execSync('npm config get cache', { encoding: 'utf8' }).trim();
}

function findNodeModules() {
  const npx = path.join(npmCache(), '_npx');
  if (!existsSync(npx)) throw new Error(`cache npx tidak ada: ${npx}`);
  for (const d of readdirSync(npx)) {
    const pj = path.join(npx, d, 'node_modules', 'paperclipai', 'package.json');
    if (existsSync(pj) && JSON.parse(readFileSync(pj, 'utf8')).version === PINNED) {
      return path.join(npx, d, 'node_modules');
    }
  }
  throw new Error(`paperclipai@${PINNED} tidak ditemukan di ${npx}`);
}

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue; // dependensi bersarang bukan bagian core yang kita periksa
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}

export function computeCoreHash() {
  const nm = findNodeModules();
  const roots = [path.join(nm, 'paperclipai')];
  const scope = path.join(nm, '@paperclipai');
  if (existsSync(scope)) for (const d of readdirSync(scope)) roots.push(path.join(scope, d));

  const files = [];
  let newest = 0;
  for (const r of roots) {
    for (const f of walk(r)) {
      const rel = path.relative(nm, f).split(path.sep).join('/');
      const st = statSync(f);
      if (st.mtimeMs > newest) newest = st.mtimeMs;
      files.push({ rel, sha: createHash('sha256').update(readFileSync(f)).digest('hex') });
    }
  }
  files.sort((a, b) => (a.rel < b.rel ? -1 : 1));
  const combined = createHash('sha256');
  for (const f of files) combined.update(`${f.rel}\0${f.sha}\n`);

  return {
    pinnedVersion: PINNED,
    nodeModulesDir: nm,
    packages: roots.map((r) => path.relative(nm, r).split(path.sep).join('/')),
    fileCount: files.length,
    newestFileMtime: new Date(newest).toISOString(),
    combinedSha256: combined.digest('hex'),
  };
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('core-hash.mjs')) {
  const args = process.argv.slice(2);
  const r = computeCoreHash();
  const summary = { ...r, computedAt: new Date().toISOString() };

  if (args[0] === '--write') {
    writeFileSync(args[1], JSON.stringify(summary, null, 2) + '\n', 'utf8');
    console.log(`baseline ditulis: ${args[1]}`);
  }
  if (args[0] === '--check') {
    const base = JSON.parse(readFileSync(args[1], 'utf8'));
    const same = base.combinedSha256 === r.combinedSha256 && base.fileCount === r.fileCount;
    console.log(same ? 'IDENTIK dengan baseline' : 'BERBEDA dari baseline!');
    console.log(`  baseline : ${base.fileCount} berkas  ${base.combinedSha256}`);
    console.log(`  sekarang : ${r.fileCount} berkas  ${r.combinedSha256}`);
    process.exit(same ? 0 : 1);
  }
  console.log(JSON.stringify(summary, null, 2));
}
