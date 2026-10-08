#!/usr/bin/env node
// render-spike.mjs — F0.7
//
// Membuktikan satu template HTML sederhana bisa dirender menjadi PNG 1080x1350
// dengan Playwright/Chromium headless di Windows, dan bahwa input yang sama
// menghasilkan file yang identik (prasyarat AC1.5).
//
// Mencatat: waktu render, ukuran file, dimensi hasil, dan hash SHA-256.
//
// Pemakaian:
//   node scripts/render-spike.mjs

import { chromium } from 'playwright';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const outDir = path.join(repoRoot, 'workspace', 'render-spike');

const WIDTH = 1080;
const HEIGHT = 1350;

// Template uji sederhana. Font sengaja memakai font sistem karena brand kit
// (dengan font lokal) baru dibuat di F1.6 — di sini yang diuji hanya pipeline render.
const html = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${WIDTH}px; height: ${HEIGHT}px; }
  body {
    display: flex; flex-direction: column; justify-content: space-between;
    padding: 96px 80px;
    background: linear-gradient(160deg, #0F172A 0%, #1E3A8A 100%);
    color: #F8FAFC;
    font-family: "Segoe UI", system-ui, sans-serif;
  }
  .kicker { font-size: 32px; letter-spacing: .18em; text-transform: uppercase; color: #93C5FD; }
  h1 { font-size: 92px; line-height: 1.08; font-weight: 700; }
  h1 em { font-style: normal; color: #FDE047; }
  .footer { display: flex; justify-content: space-between; align-items: center; font-size: 28px; color: #CBD5E1; }
  .dot { width: 18px; height: 18px; border-radius: 50%; background: #FDE047; display: inline-block; margin-right: 14px; }
</style>
</head>
<body>
  <div class="kicker"><span class="dot"></span>EdukasiAI · Uji Render F0.7</div>
  <h1>Pipeline render <em>deterministik</em> berjalan di Windows.</h1>
  <div class="footer"><span>1080 × 1350</span><span>Playwright · Chromium</span></div>
</body>
</html>`;

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

async function renderOnce(browser, file) {
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
  });
  await page.setContent(html, { waitUntil: 'load' });
  // Font sistem sudah siap setelah load; tunggu agar layout stabil.
  await page.evaluate(() => document.fonts.ready);
  const t0 = performance.now();
  await page.screenshot({ path: file, type: 'png' });
  const ms = performance.now() - t0;
  await page.close();
  return ms;
}

async function main() {
  await mkdir(outDir, { recursive: true });

  const launchStart = performance.now();
  const browser = await chromium.launch({ headless: true });
  const launchMs = performance.now() - launchStart;
  console.log(`Chromium siap dalam ${launchMs.toFixed(0)} ms`);

  const fileA = path.join(outDir, 'slide-01.png');
  const fileB = path.join(outDir, 'slide-01-ulang.png');

  const msA = await renderOnce(browser, fileA);
  const msB = await renderOnce(browser, fileB);
  await browser.close();

  const [bufA, bufB] = await Promise.all([readFile(fileA), readFile(fileB)]);
  const [stA] = await Promise.all([stat(fileA)]);

  // Dimensi dibaca langsung dari header PNG (byte 16-23), bukan dipercaya begitu saja.
  const w = bufA.readUInt32BE(16);
  const h = bufA.readUInt32BE(20);

  const hashA = sha256(bufA);
  const hashB = sha256(bufB);

  const report = {
    dimensiDiminta: `${WIDTH}x${HEIGHT}`,
    dimensiHasil: `${w}x${h}`,
    dimensiCocok: w === WIDTH && h === HEIGHT,
    ukuranFileBytes: stA.size,
    waktuLaunchChromiumMs: Math.round(launchMs),
    waktuRender1Ms: Math.round(msA),
    waktuRender2Ms: Math.round(msB),
    sha256Render1: hashA,
    sha256Render2: hashB,
    duaRenderIdentik: hashA === hashB,
    file: fileA,
  };

  console.log('\n=== HASIL ===');
  for (const [k, v] of Object.entries(report)) console.log(`${k}: ${v}`);

  await writeFile(
    path.join(outDir, 'render-spike-report.json'),
    JSON.stringify(report, null, 2),
    'utf8'
  );

  if (!report.dimensiCocok) {
    console.error('\nGAGAL: dimensi PNG tidak sesuai 1080x1350.');
    process.exit(1);
  }
  if (!report.duaRenderIdentik) {
    console.error('\nPERINGATAN: dua render dengan input sama menghasilkan file BERBEDA.');
    console.error('Ini memblokir AC1.5 (render ulang harus identik). Perlu diselidiki.');
    process.exit(2);
  }
  console.log('\nLULUS: dimensi benar dan dua render identik.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
