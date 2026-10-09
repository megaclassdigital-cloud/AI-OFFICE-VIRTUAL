#!/usr/bin/env node
// capture-asset.mjs — mengambil aset gambar slide dengan SCREENSHOT hasil pencarian gambar (dijalankan KODE, bukan LLM).
// Rantai mesin pencari (headless, tidak membuka jendela browser): google -> bing. Mesin berikutnya dicoba bila yang sebelumnya diblokir/kosong.
// Aturan owner: gambar harus screenshot nyata; yang bermerek (logo/produk) harus yang ASLI. Tidak ada gambar pengganti diam-diam:
// bila pencarian diblokir (CAPTCHA / "unusual traffic") atau tidak ada hasil layak, aset ditandai MISSING dan skrip keluar kode 2.
// CAPTCHA TIDAK dilewati. Owner dapat menaruh berkas sendiri di workspace/inbox/assets/<ISSUE>/<nama-berkas> (menang atas pencarian).
//
// Pemakaian: node scripts/capture-asset.mjs --issue EDU-27 [--requests <asset-requests.json>] [--headed] [--force]
// Keluaran : workspace/agent/runs/<ISSUE>/assets/<file> + assets-manifest.json. Exit: 0 semua ada, 2 ada yang MISSING/blocked, 1 galat.
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, statSync } from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const BLOCK_RE = /unusual traffic|lalu lintas yang tidak biasa|not a robot|bukan robot|recaptcha|\/sorry\//i;

/** Query yang dikirim ke pencarian: merek/produk asli diperkuat agar hasil teratas adalah logo/produk resmi. */
export function buildQuery(req) {
  const q = req.query.trim();
  if (req.kind === 'brand' && !/logo/i.test(q)) return `${q} logo official`;
  if (req.kind === 'product' && !/official|resmi|screenshot/i.test(q)) return `${q} official`;
  return q;
}

export function inboxPath(issue, file, rootDir = root) {
  const dir = path.join(rootDir, 'workspace', 'inbox', 'assets', issue);
  const exact = path.join(dir, file);
  if (existsSync(exact)) return exact;
  const stem = file.replace(/[.][^.]+$/, '');
  for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
    const p = path.join(dir, `${stem}.${ext}`);
    if (existsSync(p)) return p;
  }
  return null;
}

async function dismissConsent(page) {
  for (const label of [/reject all/i, /tolak semua/i, /accept all/i, /terima semua/i]) {
    const b = page.getByRole('button', { name: label }).first();
    if (await b.count().catch(() => 0)) { await b.click({ timeout: 3000 }).catch(() => {}); break; }
  }
}

async function isBlocked(page) {
  if (/\/sorry\//.test(page.url())) return true;
  const text = await page.evaluate(() => document.body?.innerText?.slice(0, 2000) ?? '').catch(() => '');
  return BLOCK_RE.test(text);
}

const BRAND_OK_RE = /logo|brand|icon|wordmark/i;
const STOP = new Set(['the', 'and', 'for', 'with', 'official', 'logo', 'dan', 'yang', 'dengan', 'screenshot', 'resmi']);

/** Token kata kunci bermakna dari query (huruf kecil, tanpa kata umum). */
export function keywords(text) {
  return [...new Set(String(text).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)))];
}

/** Skor relevansi hasil terhadap permintaan: 0..1 = porsi kata kunci yang muncul di judul/URL; merek wajib memuat nama merek DAN kata logo. */
export function scoreResult(req, item) {
  const hay = `${item.t} ${item.murl} ${item.purl}`.toLowerCase();
  const kws = keywords(req.kind === 'brand' ? (req.brand ?? req.query) : req.query);
  if (!kws.length) return 0;
  const hit = kws.filter((w) => hay.includes(w)).length / kws.length;
  if (req.kind === 'brand') return hit >= 1 && BRAND_OK_RE.test(`${item.t} ${item.murl}`) ? 1 + (/official|resmi|wordmark/i.test(item.t) ? 0.1 : 0) : 0;
  return hit;
}
export const MIN_SCORE = { photo: 0.5, product: 0.6, brand: 1 };

/** Google Images: pratinjau besar hasil teratas yang layak. */
async function googleOne(page, req, q, outFile) {
  await page.goto(`https://www.google.com/search?tbm=isch&hl=id&q=${encodeURIComponent(q)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await dismissConsent(page);
  await page.waitForTimeout(1500);
  if (await isBlocked(page)) return { status: 'blocked', reason: 'Google meminta verifikasi (CAPTCHA/unusual traffic); tidak dilewati.' };
  const handles = await page.$$('img');
  const cands = [];
  for (const h of handles) {
    const box = await h.boundingBox().catch(() => null);
    if (box && box.width >= 110 && box.height >= 80 && box.y > 120) cands.push({ h, box });
  }
  if (!cands.length) return { status: 'missing', reason: 'tidak ada hasil gambar yang terbaca' };
  for (const { h } of cands.slice(0, 6)) {
    await h.click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(1800);
    if (await isBlocked(page)) return { status: 'blocked', reason: 'diblokir setelah klik hasil' };
    const big = await page.evaluateHandle(() => {
      const imgs = [...document.images].filter((i) => /^https?:/.test(i.src) && i.naturalWidth >= 300);
      let best = null; let area = 0;
      for (const i of imgs) {
        const r = i.getBoundingClientRect();
        if (r.width < 250 || r.height < 150 || r.top < 0 || r.bottom > innerHeight + 4) continue;
        if (r.width * r.height > area) { area = r.width * r.height; best = i; }
      }
      return best;
    });
    const el = big.asElement();
    if (!el) continue;
    const href = await page.evaluate((i) => i.src, el).catch(() => '');
    await el.screenshot({ path: outFile, type: path.extname(outFile) === '.png' ? 'png' : 'jpeg' });
    return { status: 'captured', imageUrl: href.slice(0, 300), searchUrl: page.url().slice(0, 300) };
  }
  return { status: 'missing', reason: 'pratinjau besar tidak terbaca setelah beberapa percobaan' };
}

/** Bing Images: ambil URL gambar penuh dari hasil, buka gambarnya, screenshot elemen gambar. */
async function bingOne(page, req, q, outFile) {
  await page.goto(`https://www.bing.com/images/search?q=${encodeURIComponent(q)}&form=HDRSC2`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2200);
  if (await isBlocked(page)) return { status: 'blocked', reason: 'Bing meminta verifikasi' };
  const items = await page.$$eval('a.iusc', (as) => as.slice(0, 24).map((a) => { try { const m = JSON.parse(a.getAttribute('m')); return { murl: m.murl, purl: m.purl, t: m.t || '' }; } catch { return null; } }).filter(Boolean));
  if (!items.length) return { status: 'missing', reason: 'tidak ada hasil gambar yang terbaca' };
  // lebih baik MISSING daripada gambar salah: hanya hasil yang cukup relevan (merek: nama merek + kata logo) yang dipakai
  const min = MIN_SCORE[req.kind] ?? 0.5;
  const picks = items.map((i) => ({ ...i, score: scoreResult(req, i) })).filter((i) => i.score >= min).sort((a, b) => b.score - a.score).slice(0, 5);
  if (!picks.length) return { status: 'missing', reason: req.kind === 'brand' ? 'tidak ada hasil yang jelas berupa logo resmi merek tsb' : 'tidak ada hasil yang cukup relevan dengan kata kunci' };
  const shot = await page.context().newPage();
  try {
    for (const it of picks) {
      try {
        await shot.goto(it.murl, { waitUntil: 'load', timeout: 20000 });
        const el = await shot.$('img');
        const dim = el ? await el.evaluate((i) => [i.naturalWidth, i.naturalHeight]) : [0, 0];
        if (!el || dim[0] < 200 || dim[1] < 120) continue;
        await el.screenshot({ path: outFile, type: path.extname(outFile) === '.png' ? 'png' : 'jpeg' });
        return { status: 'captured', imageUrl: it.murl.slice(0, 300), searchUrl: it.purl.slice(0, 300), title: it.t.slice(0, 160) };
      } catch { /* coba hasil berikutnya */ }
    }
  } finally { await shot.close().catch(() => {}); }
  return { status: 'missing', reason: 'gambar hasil tidak bisa dibuka/terlalu kecil' };
}

export const ENGINES = { google: googleOne, bing: bingOne };

/** Coba mesin satu per satu; mesin yang diblokir dilewati untuk aset berikutnya (state.blocked). */
export async function captureOne(page, req, outFile, engines = ['google', 'bing'], state = { blocked: new Set() }) {
  const q = buildQuery(req);
  const notes = [];
  for (const name of engines) {
    if (state.blocked.has(name)) { notes.push(`${name}: blocked`); continue; }
    const r = await ENGINES[name](page, req, q, outFile).catch((e) => ({ status: 'missing', reason: `galat: ${e.message}` }));
    if (r.status === 'captured') return { ...r, query: q, engine: name };
    if (r.status === 'blocked') state.blocked.add(name);
    notes.push(`${name}: ${r.reason}`);
  }
  const allBlocked = engines.every((n) => state.blocked.has(n));
  return { status: allBlocked ? 'blocked' : 'missing', query: q, reason: notes.join(' | ') };
}

export async function main(argv) {
  const get = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
  const issue = get('--issue');
  if (!issue || !/^EDU-[0-9]+$|^TEST-[A-Z0-9-]+$/.test(issue)) { console.error('Pakai: --issue EDU-<n>'); return 1; }
  const runDir = path.join(root, 'workspace', 'agent', 'runs', issue);
  const reqFile = get('--requests') ?? path.join(runDir, 'asset-requests.json');
  if (!existsSync(reqFile)) { console.error(`Tidak ada ${reqFile}`); return 1; }
  const { requests } = JSON.parse(readFileSync(reqFile, 'utf8').replace(/^﻿/, ''));
  const assetsDir = path.join(runDir, 'assets');
  mkdirSync(assetsDir, { recursive: true });
  const force = argv.includes('--force');
  const manifestFile = path.join(runDir, 'assets-manifest.json');
  const manifest = { issue, createdAt: new Date().toISOString(), note: 'Screenshot hasil pencarian gambar atau berkas dari owner. Hak cipta tetap milik pemilik aslinya; owner bertanggung jawab atas penggunaan.', assets: [] };
  let browser = null; let context = null; let page = null;
  const engines = (get('--engines') ?? 'google,bing').split(',').filter((n) => ENGINES[n]);
  const state = { blocked: new Set() };
  try {
    for (const req of requests) {
      const out = path.join(assetsDir, req.file);
      const entry = { slide: req.slide, file: req.file, kind: req.kind, brand: req.brand ?? null };
      const owner = inboxPath(issue, req.file);
      if (owner) { copyFileSync(owner, out); manifest.assets.push({ ...entry, status: 'owner-supplied', source: owner }); continue; }
      if (!force && existsSync(out) && statSync(out).size > 2000) { manifest.assets.push({ ...entry, status: 'kept', source: 'sudah ada' }); continue; }
      if (!browser) {
        browser = await chromium.launch({ headless: !argv.includes('--headed') });
        context = await browser.newContext({ locale: 'id-ID', viewport: { width: 1400, height: 1000 } });
        page = await context.newPage();
      }
      const r = await captureOne(page, req, out, engines, state).catch((e) => ({ status: 'missing', query: buildQuery(req), reason: `galat: ${e.message}` }));
      manifest.assets.push({ ...entry, ...r, capturedAt: new Date().toISOString() });
    }
  } finally { if (browser) await browser.close(); }
  const missing = manifest.assets.filter((a) => !['captured', 'owner-supplied', 'kept'].includes(a.status));
  manifest.complete = missing.length === 0;
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  for (const a of manifest.assets) console.log(`${a.status.padEnd(14)} ${a.file}${a.engine ? `  [${a.engine}]` : ''}${a.reason ? `  — ${a.reason}` : ''}`);
  if (missing.length) {
    console.log(`\nBELUM LENGKAP: ${missing.length} aset. Taruh gambar asli di workspace/inbox/assets/${issue}/<nama-berkas> lalu jalankan ulang.`);
    return 2;
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });
}
