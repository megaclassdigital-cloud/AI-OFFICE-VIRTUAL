#!/usr/bin/env node
// office-record.mjs — bukti Office View (U4.L): rekam video + screenshot dengan Playwright, catat error konsol dan permintaan jaringan.
//
//   node scripts/office-record.mjs sim  [--out docs/evidence/U4.L] [--speed 2]
//   node scripts/office-record.mjs live [--out docs/evidence/U4.L] [--seconds 120]   (merekam keadaan live apa adanya)
//
// Server Office View harus sudah berjalan (npm run office) di http://127.0.0.1:3190.

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, renameSync, readdirSync } from 'node:fs';
import path from 'node:path';

const [mode = 'sim', ...rest] = process.argv.slice(2);
const arg = (n, d) => (rest.includes(n) ? rest[rest.indexOf(n) + 1] : d);
const out = path.resolve(arg('--out', 'docs/evidence/U4.L'));
const PAGE_URL = arg('--url', 'http://127.0.0.1:3190/');
mkdirSync(out, { recursive: true });
const tmp = path.join(out, `_video-${mode}`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: tmp, size: { width: 1280, height: 720 } } });
const page = await ctx.newPage();
const errors = []; const requests = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
page.on('request', (r) => requests.push(r.url()));

await page.goto(PAGE_URL);
await page.waitForFunction(() => window.__office && window.__office.chars().length > 0, null, { timeout: 20000 });

const shots = [];
const shot = async (name) => { const f = `${mode}-${String(shots.length + 1).padStart(2, '0')}-${name}.png`; await page.screenshot({ path: path.join(out, f) }); shots.push(f); };

if (mode === 'sim') {
  const speed = arg('--speed', '2');
  await page.click('#bSim');
  await page.waitForFunction(() => window.__office.mode() === 'sim');
  await page.click(`#speed button[data-s="${speed}"]`);
  // titik waktu simulasi untuk screenshot berurutan (detik simulasi)
  const marks = [[4, 'riset-mulai'], [14, 'komentar'], [22, 'handoff-ke-verifier'], [44, 'copywriting'], [68, 'handoff-ke-designer'], [86, 'desain'], [100, 'qa-memeriksa'], [108, 'qa-gagal-revisi'], [143, 'paket-ke-meja-owner'], [158, 'approve-papan-tayang']];
  for (const [t, name] of marks) {
    await page.waitForFunction((x) => window.__office.simClock() >= x, t, { timeout: 120000, polling: 100 });
    await shot(name);
  }
  await page.waitForFunction(() => window.__office.simClock() >= 172, null, { timeout: 120000, polling: 200 });
  await shot('selesai-lounge');
} else {
  const secs = Number(arg('--seconds', '60'));
  await shot('awal');
  const t0 = Date.now();
  while (Date.now() - t0 < secs * 1000) {
    await page.waitForTimeout(5000);
    if ((Date.now() - t0) % 20000 < 5200) await shot('t' + Math.round((Date.now() - t0) / 1000));
  }
}

const state = await page.evaluate(() => ({ mode: window.__office.mode(), chars: window.__office.chars(), metrics: window.__office.metrics(), ownerCount: window.__office.ownerCount(), board: window.__office.board() }));
await page.close();
const video = page.video();
await ctx.close();
const vpath = await video.path();
const vfile = path.join(out, `${mode}-demo.webm`);
renameSync(vpath, vfile);
await browser.close();

const origins = [...new Set(requests.map((u) => new URL(u).origin))];
const report = { mode, screenshots: shots, video: path.basename(vfile), consoleErrors: errors, networkOrigins: origins, requestCount: requests.length, state };
writeFileSync(path.join(out, `${mode}-report.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ mode, shots: shots.length, video: path.basename(vfile), consoleErrors: errors.length, networkOrigins: origins }, null, 2));
try { for (const f of readdirSync(tmp)) void f; } catch { /* folder sementara boleh tertinggal */ }
