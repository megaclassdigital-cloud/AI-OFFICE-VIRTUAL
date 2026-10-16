#!/usr/bin/env node
// capture-asset.mjs — mengambil aset gambar slide dengan SCREENSHOT hasil pencarian gambar (dijalankan KODE, bukan LLM).
// Rantai mesin pencari (headless, tidak membuka jendela browser): google -> bing. Mesin berikutnya dicoba bila yang sebelumnya diblokir/kosong.
// Aturan owner: gambar harus screenshot nyata; yang bermerek (logo/produk) harus yang ASLI. Tidak ada gambar pengganti diam-diam:
// bila pencarian diblokir (CAPTCHA / "unusual traffic") atau tidak ada hasil layak, aset ditandai MISSING dan skrip keluar kode 2.
// CAPTCHA TIDAK dilewati. Owner dapat menaruh berkas sendiri di workspace/inbox/assets/<ISSUE>/<nama-berkas> (menang atas pencarian).
//
// URUTAN: (1) berkas owner di inbox, (2) logo EdukasiAI dari brand kit, (3) GAMBAR UTAMA SUMBER PRIMER berita (og:image halaman yang divalidasi Verifier; hanya untuk
// slide dengan tepat satu sumber dan kind photo/product), (4) pencarian google -> bing. Unduhan (3) dilakukan kode langsung ke folder run, bukan lewat unduhan
// browser, sehingga folder Downloads dan unduhan lain tidak tersentuh.
//
// Pemakaian: node scripts/capture-asset.mjs --issue EDU-27 [--requests <asset-requests.json>] [--headed] [--force] [--no-source]
// Keluaran : workspace/agent/runs/<ISSUE>/assets/<file> + assets-manifest.json. Exit: 0 semua ada, 2 ada yang MISSING/blocked, 1 galat.
import './playwright-env.mjs'; // harus pertama: arahkan Playwright ke tools/ms-playwright bila ada
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROFILE_DIR } from './browser-login.mjs';
import { pickSource, extractImageUrls, extractTitle, isPublicHttpsUrl } from './source-image.mjs';
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

const BRAND_OK_RE = /logo|brand|icon|wordmark|symbol|simbol/i;
/** Gambar kosong/seragam (mis. pratinjau belum termuat): terlalu sedikit warna atau variasi terang-gelap. */
export function isBlankStats({ colors, std }) { return colors < 6 || std < 6; }

async function looksBlank(context, buf, mime) {
  const p = await context.newPage();
  try {
    const stats = await p.evaluate(async ({ b64, mime }) => {
      const img = new Image(); img.src = 'data:' + mime + ';base64,' + b64; await img.decode();
      const c = document.createElement('canvas'); c.width = 48; c.height = 48;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0, 48, 48);
      const d = g.getImageData(0, 0, 48, 48).data; const seen = new Set(); let sum = 0; let sum2 = 0; let n = 0;
      for (let i = 0; i < d.length; i += 4) { const l = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000; sum += l; sum2 += l * l; n++; seen.add(((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4)); }
      const m = sum / n; return { colors: seen.size, std: Math.sqrt(Math.max(0, sum2 / n - m * m)) };
    }, { b64: buf.toString('base64'), mime });
    return isBlankStats(stats);
  } catch { return false; } finally { await p.close().catch(() => {}); }
}

/**
 * Pola kotak-kotak transparansi (checkerboard): sepanjang garis pindai luminans terlihat LONCATAN KECIL (6-60) yang bergantian naik/turun dengan jarak teratur.
 * rows = daftar garis pindai (array luminans 0-255). Teks/logo (tepi tajam) dan foto (landai/acak) tidak terdeteksi.
 */
export function hasCheckerboard(rows) {
  for (const row of rows) {
    const steps = [];
    for (let i = 1; i < row.length; i++) {
      const d = row[i] - row[i - 1];
      if (Math.abs(d) >= 6 && Math.abs(d) <= 60 && (!steps.length || i - steps[steps.length - 1].at > 1)) steps.push({ at: i, up: d > 0 });
    }
    if (steps.length < 6) continue;
    const alternating = steps.every((st, k) => k === 0 || st.up !== steps[k - 1].up);
    const gaps = steps.slice(1).map((st, k) => st.at - steps[k].at);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const dev = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length);
    if (alternating && mean >= 4 && mean <= 60 && dev <= mean * 0.25) return true;
  }
  return false;
}

/** Garis pindai di dekat tepi atas/bawah gambar (tempat latar transparan biasanya terlihat). */
async function edgeRows(context, buf, mime) {
  const p = await context.newPage();
  try {
    return await p.evaluate(async ({ b64, mime }) => {
      const img = new Image(); img.src = 'data:' + mime + ';base64,' + b64; await img.decode();
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const ys = [6, 14, c.height - 14, c.height - 6].filter((y) => y >= 0 && y < c.height);
      return ys.map((y) => { const d = g.getImageData(0, y, c.width, 1).data; const row = []; for (let i = 0; i < d.length; i += 4) row.push((d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000); return row; });
    }, { b64: buf.toString('base64'), mime });
  } catch { return []; } finally { await p.close().catch(() => {}); }
}

/** Ambil file gambar asli dari URL-nya dan tempelkan di atas latar putih (transparansi jadi putih, bukan kotak-kotak). */
async function saveComposite(page, url, outFile, { minW = 200, minH = 120 } = {}) {
  if (!/^https?:/.test(String(url))) return false;
  const resp = await page.context().request.get(url, { timeout: 15000 }).catch(() => null);
  if (!resp || !resp.ok()) return false;
  const ct = String(resp.headers()['content-type'] ?? '').split(';')[0];
  if (!/^image\/(png|jpeg|webp|gif)$/.test(ct)) return false; // SVG/lain: lewati
  const body = await resp.body();
  if (body.length < 2000 || body.length > 8 * 1024 * 1024) return false;
  const p = await page.context().newPage();
  try {
    const type = path.extname(outFile) === '.png' ? 'image/png' : 'image/jpeg';
    const out = await p.evaluate(async ({ b64, ct, type, minW, minH }) => {
      const img = new Image(); img.src = 'data:' + ct + ';base64,' + b64; await img.decode();
      const w = img.naturalWidth; const h = img.naturalHeight;
      if (w < minW || h < minH) return null;
      const k = Math.min(1, 1600 / Math.max(w, h));
      const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
      const g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL(type, 0.92).split(',')[1];
    }, { b64: body.toString('base64'), ct, type, minW, minH });
    if (!out) return false;
    const buf = Buffer.from(out, 'base64');
    if (await looksBlank(page.context(), buf, type)) return false;
    writeFileSync(outFile, buf);
    return true;
  } catch { return false; } finally { await p.close().catch(() => {}); }
}

/**
 * Ambil screenshot sebagai buffer, tolak bila kosong, baru tulis ke berkas. Untuk logo/produk (opts.checkTransparency) pola kotak-kotak transparansi
 * tidak boleh ikut: bila terdeteksi, file aslinya diambil dari opts.imageUrl dan ditempel di atas putih; gagal => kandidat ditolak.
 * Mengembalikan false | 'screenshot' | 'fetch-on-white'.
 */
async function saveShot(page, outFile, shotFn, opts = {}) {
  const type = path.extname(outFile) === '.png' ? 'png' : 'jpeg';
  // Logo/produk: file asli dari URL gambar yang ditampilkan pencarian (tanpa label/overlay UI pencarian, transparansi jadi putih) didahulukan; screenshot pratinjau menjadi cadangan.
  if (opts.originalFirst && opts.imageUrl && (await saveComposite(page, opts.imageUrl, outFile))) return 'fetch-on-white';
  const buf = await shotFn(type);
  if (await looksBlank(page.context(), buf, 'image/' + type)) return false;
  if (opts.checkTransparency && hasCheckerboard(await edgeRows(page.context(), buf, 'image/' + type))) {
    return opts.imageUrl && (await saveComposite(page, opts.imageUrl, outFile)) ? 'fetch-on-white' : false;
  }
  writeFileSync(outFile, buf);
  return 'screenshot';
}

const STOP = new Set(['the', 'and', 'for', 'with', 'official', 'logo', 'dan', 'yang', 'dengan', 'screenshot', 'resmi']);

/** Token kata kunci bermakna dari query (huruf kecil, tanpa kata umum). */
export function keywords(text) {
  return [...new Set(String(text).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)))];
}

/** Skor relevansi hasil terhadap permintaan: 0..1 = porsi kata kunci yang muncul di judul/URL; merek wajib memuat nama merek DAN kata logo. */
/** Hasil yang jelas bukan tampilan/logo resmi (konsep desainer, mockup, fan art): ditolak untuk merek/produk. */
export const NOT_OFFICIAL_RE = /concept|mock-?up|dribbble|behance|wireframe|figma|template|redesign|fan.?art|parody|clipart|vector art|ui dux|dashboard design/i;
/** Situs foto stok / watermark: tidak boleh dipakai untuk jenis aset apa pun. */
export const STOCK_RE = /shutterstock|istock|getty ?images|alamy|depositphotos|dreamstime|123rf|adobe stock|stock photo|royalty-?free|watermark/i;
export function scoreResult(req, item) {
  if (STOCK_RE.test(String(item.t ?? '')) || STOCK_RE.test(String(item.purl ?? ''))) return 0;
  if ((req.kind === 'brand' || req.kind === 'product') && NOT_OFFICIAL_RE.test(String(item.t ?? ''))) return 0;
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
  // kandidat grid: gambar + teks judul/sumber di dekatnya; diberi skor relevansi (merek: nama merek + kata logo)
  const grid = await page.evaluate(() => [...document.images].map((img, idx) => {
    const r = img.getBoundingClientRect();
    if (r.width < 110 || r.height < 80 || r.top < 120 || r.bottom > innerHeight) return null;
    return { idx, x: r.x + r.width / 2, y: r.y + r.height / 2, t: (img.alt || '').slice(0, 200) }; // judul hasil ada di atribut alt
  }).filter(Boolean));
  if (!grid.length) return { status: 'missing', reason: 'tidak ada hasil gambar yang terbaca' };
  const min = MIN_SCORE[req.kind] ?? 0.5;
  const ranked = grid.map((g) => ({ ...g, score: scoreResult(req, { t: g.t, murl: '', purl: '' }) })).filter((g) => g.score >= min).sort((x, y) => y.score - x.score).slice(0, 4);
  if (!ranked.length) return { status: 'missing', reason: req.kind === 'brand' ? 'tidak ada hasil yang jelas berupa logo resmi merek tsb' : 'tidak ada hasil yang cukup relevan dengan kata kunci' };
  for (const g of ranked) {
    await page.mouse.click(g.x, g.y);
    await page.waitForTimeout(2200);
    if (await isBlocked(page)) return { status: 'blocked', reason: 'diblokir setelah klik hasil' };
    // pratinjau besar di panel kanan: gambar bersumber http(s) terbesar yang tampak penuh di viewport
    const big = await page.evaluate(() => {
      let best = null; let area = 0;
      for (const i of document.images) {
        if (!/^https?:/.test(i.src) || i.naturalWidth < 300) continue;
        const r = i.getBoundingClientRect();
        if (r.left < 700 || r.width < 250 || r.height < 150 || r.top < 0 || r.bottom > innerHeight + 4) continue;
        if (r.width * r.height > area) { area = r.width * r.height; const sc = Math.min(r.width / i.naturalWidth, r.height / i.naturalHeight); const w = i.naturalWidth * sc; const h = i.naturalHeight * sc; best = { x: r.x + (r.width - w) / 2 + 1, y: r.y + (r.height - h) / 2 + 1, width: w - 2, height: h - 2, src: i.src }; }
      }
      return best;
    });
    if (!big) continue;
    // sembunyikan tombol overlay UI Google (lensa/aksi) agar tidak ikut terpotret; gambarnya sendiri tidak diubah
    await page.addStyleTag({ content: 'button, [role=button], [aria-label*=ens] { visibility: hidden !important; }' }).catch(() => {});
    await page.waitForTimeout(150);
    await page.waitForTimeout(900); // beri waktu gambar pratinjau selesai dirender
    const saved = await saveShot(page, outFile, (type) => page.screenshot({ type, clip: { x: big.x, y: big.y, width: big.width, height: big.height } }), { checkTransparency: req.kind !== 'photo', originalFirst: req.kind !== 'photo', imageUrl: big.src });
    if (!saved) continue; // kosong / kotak-kotak tanpa file asli: coba kandidat berikutnya
    return { status: 'captured', method: saved, imageUrl: big.src.slice(0, 300), searchUrl: page.url().slice(0, 300), title: g.t.slice(0, 160) };
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
        const saved = await saveShot(page, outFile, (type) => el.screenshot({ type }), { checkTransparency: req.kind !== 'photo', originalFirst: req.kind !== 'photo', imageUrl: it.murl });
        if (!saved) continue; // kosong / kotak-kotak tanpa file asli: coba hasil berikutnya
        return { status: 'captured', method: saved, imageUrl: it.murl.slice(0, 300), searchUrl: it.purl.slice(0, 300), title: it.t.slice(0, 160) };
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

/** Gambar utama halaman sumber primer (og:image) -> PNG/JPEG di outFile. Mengembalikan { ok, imageUrl, title } atau { ok:false, reason }. */
export async function fromSource(page, src, outFile) {
  const urls = []; let title = null; const notes = [];
  if (src.imageUrl && isPublicHttpsUrl(src.imageUrl)) urls.push(src.imageUrl);
  const resp = await page.context().request.get(src.url, { timeout: 20000, headers: { accept: 'text/html,application/xhtml+xml' } }).catch(() => null);
  if (resp && resp.ok() && /html/i.test(String(resp.headers()['content-type'] ?? ''))) {
    const html = await resp.text();
    title = extractTitle(html);
    for (const u of extractImageUrls(html, resp.url())) if (!urls.includes(u)) urls.push(u);
  } else notes.push(`halaman sumber tidak terbaca (${resp ? resp.status() : 'tanpa respons'})`);
  for (const u of urls.slice(0, 4)) {
    // foto sumber harus cukup besar untuk memenuhi separuh atas slide tanpa pecah
    if (await saveComposite(page, u, outFile, { minW: 600, minH: 300 })) return { ok: true, imageUrl: u, title: title ?? src.title ?? null };
  }
  notes.push(urls.length ? 'gambar utama sumber tidak memenuhi syarat (format/ukuran minimal 600x300)' : 'sumber tidak menyediakan gambar utama (og:image)');
  return { ok: false, reason: notes.join('; ') };
}

export async function main(argv) {
  const get = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
  const issue = get('--issue');
  if (!issue || !/^EDU-[0-9]+(?:\/revision-[0-9]+)?$|^TEST-[A-Z0-9-]+$/.test(issue)) { console.error('Pakai: --issue EDU-<n>'); return 1; }
  const runDir = path.join(root, 'workspace', 'agent', 'runs', ...issue.split('/'));
  const reqFile = get('--requests') ?? path.join(runDir, 'asset-requests.json');
  if (!existsSync(reqFile)) { console.error(`Tidak ada ${reqFile}`); return 1; }
  const { requests } = JSON.parse(readFileSync(reqFile, 'utf8').replace(/^﻿/, ''));
  const assetsDir = path.join(runDir, 'assets');
  mkdirSync(assetsDir, { recursive: true });
  const force = argv.includes('--force');
  const manifestFile = path.join(runDir, 'assets-manifest.json');
  let prev = null; try { prev = JSON.parse(readFileSync(manifestFile, 'utf8').replace(/^\uFEFF/, '')); } catch { /* belum ada manifest */ }
  const prevBy = new Map((prev?.assets ?? []).map((a) => [a.file, a]));
  const manifest = { issue, createdAt: new Date().toISOString(), note: 'Screenshot hasil pencarian gambar atau berkas dari owner. Hak cipta tetap milik pemilik aslinya; owner bertanggung jawab atas penggunaan.', assets: [] };
  const readJ = (p) => { try { return JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } };
  const srcData = { carousel: readJ(path.join(runDir, 'carousel.json')), research: readJ(path.join(runDir, 'research-output.json')), verification: readJ(path.join(runDir, 'verification-result.json')) };
  let browser = null; let context = null; let page = null;
  const engines = (get('--engines') ?? 'google,bing').split(',').filter((n) => ENGINES[n]);
  const state = { blocked: new Set() };
  let queried = 0;
  const PACE_MS = Number(process.env.AAO_CAPTURE_PACE_MS ?? 9000);
  try {
    for (const req of requests) {
      const out = path.join(assetsDir, req.file);
      const entry = { slide: req.slide, file: req.file, kind: req.kind, brand: req.brand ?? null };
      const owner = inboxPath(issue, req.file);
      if (owner) { copyFileSync(owner, out); manifest.assets.push({ ...entry, status: 'owner-supplied', source: owner }); continue; }
      // Logo EdukasiAI sendiri: berkas resmi ada di brand kit; tidak perlu dan tidak boleh dicari di Google (rawan CAPTCHA, hasil bisa salah).
      const ownLogo = path.join(root, 'divisions', 'edukasiai', 'brand', 'logo', 'edukasiai-logo.png');
      if (req.kind === 'brand' && /edukasi\s*-?\s*ai/i.test(`${req.brand ?? ''} ${req.query ?? ''}`) && existsSync(ownLogo)) { copyFileSync(ownLogo, out); manifest.assets.push({ ...entry, status: 'owner-supplied', source: ownLogo }); continue; }
      // Berkas yang sudah ada hanya dipertahankan bila manifest sebelumnya mencatatnya hasil capture/owner (bukti ikut dibawa); selain itu diambil ulang.
      const was = prevBy.get(req.file);
      if (!force && existsSync(out) && statSync(out).size > 2000 && was && ['captured', 'owner-supplied'].includes(was.status)) { manifest.assets.push({ ...was, keptAt: new Date().toISOString() }); continue; }
      const ensurePage = async () => {
        if (context) return;
        // Profil Edge tersimpan (sesi hasil verifikasi OWNER via browser-login.mjs) dipakai bila ada; selain itu Chromium bawaan.
        if (existsSync(PROFILE_DIR) && !argv.includes('--no-profile')) {
          context = await chromium.launchPersistentContext(PROFILE_DIR, { channel: 'msedge', headless: !argv.includes('--headed'), locale: 'id-ID', viewport: { width: 1400, height: 1000 } });
        } else {
          browser = await chromium.launch({ headless: !argv.includes('--headed') });
          context = await browser.newContext({ locale: 'id-ID', viewport: { width: 1400, height: 1000 } });
        }
        page = await context.newPage();
      };
      // (3) Sumber primer: hanya foto/produk pada slide dengan tepat satu sumber terverifikasi.
      let sourceNote = null;
      if (['photo', 'product'].includes(req.kind) && !argv.includes('--no-source')) {
        const src = pickSource({ slideIndex: req.slide, ...srcData });
        if (src) {
          await ensurePage();
          const s = await fromSource(page, src, out).catch((e) => ({ ok: false, reason: `galat: ${String(e?.message ?? e).slice(0, 80)}` }));
          if (s.ok) { manifest.assets.push({ ...entry, status: 'captured', engine: 'sumber-primer', source: src.url, sourceId: src.id, imageUrl: s.imageUrl, title: s.title, capturedAt: new Date().toISOString() }); continue; }
          sourceNote = `sumber primer (${src.id}): ${s.reason}`;
        }
      }
      await ensurePage();
      // Pembatasan laju: pencarian beruntun cepat memicu verifikasi Google; beri jeda antar permintaan (bukan mengakali verifikasi).
      if (queried++ > 0) await new Promise((res) => setTimeout(res, PACE_MS));
      const r = await captureOne(page, req, out, engines, state).catch((e) => ({ status: 'missing', query: buildQuery(req), reason: `galat: ${e.message}` }));
      if (sourceNote && r.status !== 'captured') r.reason = [sourceNote, r.reason].filter(Boolean).join(' | ');
      manifest.assets.push({ ...entry, ...r, capturedAt: new Date().toISOString() });
    }
  } finally { if (context) await context.close().catch(() => {}); if (browser) await browser.close().catch(() => {}); }
  const missing = manifest.assets.filter((a) => !['captured', 'owner-supplied'].includes(a.status));
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
