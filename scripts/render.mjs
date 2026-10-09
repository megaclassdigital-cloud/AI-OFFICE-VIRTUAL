#!/usr/bin/env node
// render.mjs — Renderer deterministik EdukasiAI (F1.8)
//
// Mengubah carousel-design.json menjadi PNG per slide + contact-sheet.png,
// sekaligus menjalankan cek visual otomatis dan menulis visual-qa.json.
//
// Prinsip (ADR-0002 dan CLAUDE.md aturan 6):
//   - Designer hanya mengisi slot. Renderer yang menentukan tata letak.
//   - Semua keputusan lolos/gagal di sini DETERMINISTIK, bukan penilaian LLM.
//   - Teks yang tidak muat DITOLAK, bukan dipotong diam-diam (AC1.6).
//   - Input sama harus menghasilkan berkas identik (AC1.5).
//
// Pemakaian:
//   node scripts/render.mjs --design <path> [--out <dir>] [--division edukasiai]

import { chromium } from 'playwright';
import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const o = { division: 'edukasiai' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--design') o.design = argv[++i];
    else if (argv[i] === '--out') o.out = argv[++i];
    else if (argv[i] === '--division') o.division = argv[++i];
  }
  return o;
}

const args = parseArgs(process.argv.slice(2));
if (!args.design) {
  console.error('Pemakaian: node scripts/render.mjs --design <carousel-design.json> [--out <dir>]');
  process.exit(1);
}

const designPath = path.resolve(args.design);
const brandDir = path.join(repoRoot, 'divisions', args.division, 'brand');
const outDir = path.resolve(args.out ?? path.join(repoRoot, 'workspace', 'render'));

const fail = (m) => {
  console.error(`\nGAGAL: ${m}`);
  process.exit(1);
};

// ── Util ──────────────────────────────────────────────────────────────────────

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Bungkus kata yang ditekankan dengan <mark>. Dilakukan SETELAH escape. */
function applyEmphasis(escaped, emphasis) {
  let out = escaped;
  for (const word of emphasis ?? []) {
    const w = escapeHtml(word);
    if (!w) continue;
    out = out.replace(new RegExp(escapeRe(w), 'g'), `<mark>${w}</mark>`);
  }
  return out;
}

/** Relative luminance menurut WCAG. */
function luminance([r, g, b]) {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

function parseColor(str) {
  const m = String(str).match(/^#?([0-9a-f]{6})$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = String(str).match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

/** Warna latar efektif: ambil warna solid pertama dari gradient, atau warna itu sendiri. */
function backgroundSampleColor(bg) {
  const hits = String(bg).match(/#[0-9a-f]{6}/gi);
  if (hits && hits.length) return parseColor(hits[0]);
  return parseColor(bg) ?? [0, 0, 0];
}

// ── Muat input ────────────────────────────────────────────────────────────────

if (!existsSync(designPath)) fail(`design tidak ditemukan: ${designPath}`);
if (!existsSync(brandDir)) fail(`brand kit tidak ditemukan: ${brandDir}`);

const design = JSON.parse(await readFile(designPath, 'utf8'));
const brand = JSON.parse(await readFile(path.join(brandDir, 'brand.json'), 'utf8'));
const templatesCfg = JSON.parse(await readFile(path.join(brandDir, 'templates.json'), 'utf8'));

const W = design.canvas?.width ?? brand.canvas.width;
const H = design.canvas?.height ?? brand.canvas.height;
const minFontPx = brand.typography.minFontPx;
const minContrast = brand.minContrastRatio;

// ── Ikon dan aset gambar (hanya berkas lokal; renderer tidak pernah mengambil apa pun dari jaringan) ──
const iconCache = new Map();
function iconSvg(name) {
  if (!/^[a-z0-9-]+$/.test(String(name))) return null;
  if (iconCache.has(name)) return iconCache.get(name);
  const fp = path.join(brandDir, brand.iconDir, `${name}.svg`);
  let svg = null;
  if (existsSync(fp)) svg = readFileSync(fp, 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/\s(width|height|class)="[^"]*"/g, '').trim();
  iconCache.set(name, svg);
  return svg;
}
const IMAGE_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
/** "brand/x.png" -> brand kit assets/; selain itu relatif ke workspace/agent/. Mengembalikan { file } atau { error }. */
function resolveAsset(value) {
  const v = String(value ?? '');
  const base = v.startsWith('brand/') ? path.join(brandDir, 'assets') : path.join(repoRoot, 'workspace', 'agent');
  const rel = v.startsWith('brand/') ? v.slice('brand/'.length) : v;
  const abs = path.resolve(base, rel);
  if (abs !== base && !abs.startsWith(path.resolve(base) + path.sep)) return { error: 'path di luar folder aset yang diizinkan' };
  const mime = IMAGE_EXT[path.extname(abs).toLowerCase()];
  if (!mime) return { error: 'ekstensi gambar harus png/jpg/webp' };
  if (!existsSync(abs)) return { error: 'berkas tidak ada' };
  if (statSync(abs).size > MAX_IMAGE_BYTES) return { error: 'gambar lebih dari 6 MB' };
  return { file: abs, mime };
}

// ── Validasi SEBELUM render (gagal cepat, pesan jelas) ───────────────────────
// AC1.6: teks terlalu panjang ditolak di sini, tidak dipotong diam-diam.

const preErrors = [];
for (const slide of design.slides ?? []) {
  const tpl = templatesCfg.templates[slide.template];
  if (!tpl) {
    preErrors.push(`slide ${slide.index}: template "${slide.template}" tidak ada di templates.json`);
    continue;
  }
  if (!existsSync(path.join(brandDir, tpl.file))) {
    preErrors.push(`slide ${slide.index}: berkas template hilang: ${tpl.file}`);
  }
  for (const [name, value] of Object.entries(slide.slots ?? {})) {
    const def = tpl.slots[name];
    if (!def) {
      preErrors.push(`slide ${slide.index}: slot "${name}" tidak dikenal untuk template "${slide.template}"`);
      continue;
    }
    if (def.type === 'icon') {
      if (!iconSvg(value)) preErrors.push(`slide ${slide.index}: ikon "${value}" di slot "${name}" tidak ada di set ikon brand kit`);
      continue;
    }
    if (def.type === 'image') {
      const r = resolveAsset(value);
      if (r.error) preErrors.push(`slide ${slide.index}: gambar "${value}" di slot "${name}" ditolak: ${r.error}`);
      continue;
    }
    const len = String(value).length;
    if (len > def.maxChars) {
      preErrors.push(
        `slide ${slide.index}: slot "${name}" ${len} karakter, melebihi batas ${def.maxChars}. ` +
          `Teks TIDAK dipotong — perbaiki di Designer.`
      );
    }
  }
  for (const [name, def] of Object.entries(tpl.slots)) {
    if (def.required && !String(slide.slots?.[name] ?? '').trim()) {
      preErrors.push(`slide ${slide.index}: slot wajib "${name}" kosong`);
    }
  }
  for (const word of slide.emphasis ?? []) {
    const textSlots = Object.entries(slide.slots ?? {}).filter(([k]) => !tpl.slots[k]?.type).map(([, v]) => v);
    const inSlots = textSlots.some((v) => String(v).includes(word));
    if (!inSlots) {
      preErrors.push(`slide ${slide.index}: kata tekanan "${word}" tidak ada di slot mana pun`);
    }
  }
  if (slide.colorVariant && !brand.variants[slide.colorVariant]) {
    preErrors.push(`slide ${slide.index}: varian warna "${slide.colorVariant}" tidak ada di brand.json`);
  }
  if (slide.icon) {
    const iconPath = path.join(brandDir, brand.iconDir, `${slide.icon}.svg`);
    if (!existsSync(iconPath)) preErrors.push(`slide ${slide.index}: ikon "${slide.icon}" tidak ada`);
  }
}

if (preErrors.length) {
  console.error('\nValidasi desain GAGAL. Tidak ada PNG yang dibuat.\n');
  for (const e of preErrors) console.error(`  - ${e}`);
  process.exit(2);
}

// ── Render ────────────────────────────────────────────────────────────────────

// Kosongkan isinya, jangan hapus foldernya: di Windows rmdir gagal EBUSY kalau
// ada shell atau proses lain yang sedang berada di direktori itu.
await mkdir(outDir, { recursive: true });
for (const entry of await readdir(outDir)) {
  await rm(path.join(outDir, entry), { recursive: true, force: true });
}

const browser = await chromium.launch({ headless: true });
// Font lokal (F1.6a): di-embed sebagai data URI supaya render tidak menyentuh jaringan dan tidak bergantung
// pada font yang terpasang di mesin. Tanpa ini Chromium diam-diam jatuh ke Segoe UI.
const fontDir = path.join(brandDir, brand.typography.localFontDir ?? 'fonts');
// Font dan bobot dibaca dari brand.json (typography.fontFamily + typography.fontFiles); bawaan Inter agar brand kit lama tetap jalan.
const FONT_FAMILY = brand.typography.fontFamily ?? 'Inter';
const FONT_FILES = brand.typography.fontFiles ?? [[400, 'Inter-Regular.woff2'], [500, 'Inter-Medium.woff2'], [600, 'Inter-SemiBold.woff2'], [700, 'Inter-Bold.woff2']];
let fontCss = '';
for (const [weight, file] of FONT_FILES) {
  const fp = path.join(fontDir, file);
  if (!existsSync(fp)) {
    console.error(`GAGAL: font lokal tidak ada: ${fp}`);
    process.exit(2);
  }
  const b64 = (await readFile(fp)).toString('base64');
  fontCss += `@font-face{font-family:'${FONT_FAMILY}';font-style:normal;font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2');}
`;
}
const fontsUsed = new Set();
const slideResults = [];
const total = design.slides.length;

try {
  for (const slide of design.slides) {
    const tpl = templatesCfg.templates[slide.template];
    const variant = brand.variants[slide.colorVariant || brand.defaultVariant];
    const rawHtml = await readFile(path.join(brandDir, tpl.file), 'utf8');

    const vars = `
      :root {
        --canvas-w: ${W}px;
        --canvas-h: ${H}px;
        --safe-margin: ${brand.canvas.safeMargin}px;
        --font-stack: ${brand.typography.fontFamilyStack};
        --bg: ${variant.background};
        --text: ${variant.text};
        --muted: ${variant.muted};
        --accent: ${variant.accent};
        --kicker: ${variant.kicker};
        --fs-kicker: ${brand.typography.scale.kicker}px;
        --fs-body: ${brand.typography.scale.body}px;
        --fs-heading: ${brand.typography.scale.heading}px;
        --fs-display: ${brand.typography.scale.display}px;
        --fs-hero: ${brand.typography.scale.hero}px;
        --fs-stat: ${brand.typography.scale.stat}px;
      }`;

    const page = await browser.newPage({
      viewport: { width: W, height: H },
      deviceScaleFactor: 1,
    });

    await page.setContent(rawHtml, {
      waitUntil: 'load',
      baseURL: pathToFileURL(path.join(brandDir, 'templates') + path.sep).href,
    });
    await page.addStyleTag({ content: fontCss });
    await page.addStyleTag({ content: vars });
    await page.addStyleTag({ path: path.join(brandDir, 'templates', 'base.css') });

    // Ikon (slot bertipe icon + [data-icon] statis) dan gambar (slot bertipe image) disiapkan di sisi Node.
    const icons = {}; const images = {};
    for (const [name, value] of Object.entries(slide.slots ?? {})) {
      const def = tpl.slots[name];
      if (def?.type === 'icon') icons[name] = iconSvg(value);
      if (def?.type === 'image') { const r = resolveAsset(value); images[name] = `data:${r.mime};base64,${readFileSync(r.file).toString('base64')}`; }
    }
    const staticIcons = {};
    for (const m of rawHtml.matchAll(/data-icon="([a-z0-9-]+)"/g)) staticIcons[m[1]] = iconSvg(m[1]) ?? '';
    // Isi slot. Kosongkan elemen yang slotnya tidak diisi agar tidak ada sisa markup.
    await page.evaluate(
      ({ slots, emphasisHtml, brandmark, counter, icons, images, staticIcons }) => {
        document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = staticIcons[el.getAttribute('data-icon')] ?? ''; });
        document.querySelectorAll('[data-slot]').forEach((el) => {
          const name = el.getAttribute('data-slot');
          if (Object.prototype.hasOwnProperty.call(icons, name)) {
            el.innerHTML = icons[name] ?? '';
          } else if (Object.prototype.hasOwnProperty.call(images, name)) {
            el.setAttribute('src', images[name]);
          } else if (Object.prototype.hasOwnProperty.call(emphasisHtml, name)) {
            el.innerHTML = emphasisHtml[name];
          } else if (Object.prototype.hasOwnProperty.call(slots, name)) {
            el.textContent = slots[name];
          } else {
            el.remove();
          }
        });
        document.querySelectorAll('[data-brandmark]').forEach((el) => (el.textContent = brandmark));
        document.querySelectorAll('[data-slide-counter]').forEach((el) => (el.textContent = counter));
      },
      {
        slots: slide.slots ?? {},
        emphasisHtml: Object.fromEntries(
          Object.entries(slide.slots ?? {}).filter(([k]) => !tpl.slots[k]?.type).map(([k, v]) => [k, applyEmphasis(escapeHtml(v), slide.emphasis)])
        ),
        icons,
        images,
        staticIcons,
        brandmark: brand.logo.text,
        counter: brand.slideCounter === false ? '' : `${slide.index}/${total}`,
      }
    );

    await page.evaluate(() => Promise.all([...document.images].map((im) => im.decode().catch(() => {}))));
    await page.evaluate(() => document.fonts.ready);
    const loadedFonts = await page.evaluate(() =>
      [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family.replace(/['"]/g, '')} ${f.weight}`)
    );
    if (!loadedFonts.some((f) => f.startsWith(`${FONT_FAMILY} `))) throw new Error(`font ${FONT_FAMILY} tidak termuat pada slide ${slide.index}; jatuh ke font lain`);
    loadedFonts.forEach((f) => fontsUsed.add(f));

    // ── Cek visual dari DOM, bukan dari gambar ─────────────────────────────
    const measured = await page.evaluate(
      ({ minFontPx }) => {
        const overflow = [];
        const small = [];
        const docH = document.documentElement.clientHeight;
        const docW = document.documentElement.clientWidth;

        // Elemen apa pun yang keluar kanvas = meluber
        document.querySelectorAll('body *').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) return;
          if (r.bottom > docH + 1 || r.right > docW + 1 || r.top < -1 || r.left < -1) {
            overflow.push({
              tag: el.tagName.toLowerCase(),
              slot: el.getAttribute('data-slot'),
              rect: { top: Math.round(r.top), bottom: Math.round(r.bottom), right: Math.round(r.right) },
            });
          }
          // Teks terpotong DI DALAM elemennya sendiri hanya mungkin bila elemen
          // itu memang memotong isinya. Pada overflow:visible teks cuma meluap
          // dan sudah tertangkap cek bounding box di atas; menandainya di sini
          // menghasilkan positif palsu pada heading berukuran besar.
          const ov = getComputedStyle(el);
          const clips = ov.overflowY !== 'visible' || ov.overflowX !== 'visible';
          if (clips && el.scrollHeight > el.clientHeight + 1 && el.clientHeight > 0) {
            overflow.push({ tag: el.tagName.toLowerCase(), slot: el.getAttribute('data-slot'), clipped: true });
          }
        });

        // Ukuran font setiap elemen yang punya teks
        document.querySelectorAll('body *').forEach((el) => {
          const hasText = Array.from(el.childNodes).some(
            (n) => n.nodeType === 3 && n.textContent.trim().length > 0
          );
          if (!hasText) return;
          const fs = parseFloat(getComputedStyle(el).fontSize);
          if (fs < minFontPx) small.push({ slot: el.getAttribute('data-slot'), fontSize: fs });
        });

        // Pasangan warna teks + latar EFEKTIF. Latar dicari dengan menelusuri
        // leluhur sampai menemukan background-color yang tidak transparan —
        // kalau tidak, tombol berlatar sendiri akan dibandingkan dengan latar
        // halaman dan menghasilkan kegagalan palsu.
        const effectiveBg = (el) => {
          let n = el;
          while (n && n !== document.documentElement) {
            const bg = getComputedStyle(n).backgroundColor;
            const m = bg.match(/rgba?\(([^)]+)\)/);
            if (m) {
              const parts = m[1].split(',').map((s) => parseFloat(s));
              const alpha = parts.length > 3 ? parts[3] : 1;
              if (alpha > 0.5) return bg;
            }
            n = n.parentElement;
          }
          return null; // pakai latar halaman dari brand.json
        };

        const pairs = [];
        document.querySelectorAll('body *').forEach((el) => {
          const hasText = Array.from(el.childNodes).some(
            (n) => n.nodeType === 3 && n.textContent.trim().length > 0
          );
          if (!hasText) return;
          pairs.push({
            slot: el.getAttribute('data-slot'),
            color: getComputedStyle(el).color,
            bg: effectiveBg(el),
          });
        });

        return { overflow, small, pairs };
      },
      { minFontPx }
    );

    const file = `slide-${String(slide.index).padStart(2, '0')}.png`;
    await page.screenshot({ path: path.join(outDir, file), type: 'png' });
    await page.close();

    // Kontras dihitung di Node supaya logikanya bisa diuji unit terpisah.
    const pageBg = backgroundSampleColor(variant.background);
    const contrastFails = [];
    for (const p of measured.pairs) {
      const fg = parseColor(p.color);
      if (!fg) continue;
      const bg = p.bg ? parseColor(p.bg) ?? pageBg : pageBg;
      const ratio = contrastRatio(fg, bg);
      if (ratio < minContrast) {
        contrastFails.push({ slot: p.slot, color: p.color, bg: p.bg ?? 'latar halaman', ratio: Number(ratio.toFixed(2)) });
      }
    }

    const checks = {
      dimensions: { ok: true, measured: `${W}x${H}` },
      noOverflow: {
        ok: measured.overflow.length === 0,
        detail: measured.overflow.length ? JSON.stringify(measured.overflow).slice(0, 900) : undefined,
      },
      minFontSize: {
        ok: measured.small.length === 0,
        measured: brand.typography.minFontPx,
        detail: measured.small.length ? JSON.stringify(measured.small).slice(0, 400) : undefined,
      },
      contrast: {
        ok: contrastFails.length === 0,
        measured: minContrast,
        detail: contrastFails.length ? JSON.stringify(contrastFails).slice(0, 400) : undefined,
      },
      slotLimits: { ok: true, detail: 'divalidasi sebelum render' },
    };

    slideResults.push({
      index: slide.index,
      file,
      template: slide.template,
      passed: Object.values(checks).every((c) => c.ok),
      checks,
    });
  }

  // ── Contact sheet ──────────────────────────────────────────────────────────
  const cols = Math.min(4, total);
  const rows = Math.ceil(total / cols);
  const thumbW = 270;
  const thumbH = Math.round((H / W) * thumbW);
  const sheet = await browser.newPage({
    viewport: { width: cols * thumbW, height: rows * thumbH },
    deviceScaleFactor: 1,
  });
  // PNG disematkan sebagai data URI: halaman about:blank tidak boleh memuat
  // file:// sehingga <img src="file://..."> menghasilkan gambar rusak.
  const imgs = (
    await Promise.all(
      slideResults.map(async (s) => {
        const b64 = (await readFile(path.join(outDir, s.file))).toString('base64');
        return `<img src="data:image/png;base64,${b64}" style="width:${thumbW}px;height:${thumbH}px;display:block">`;
      })
    )
  ).join('');
  await sheet.setContent(
    `<body style="margin:0;display:grid;grid-template-columns:repeat(${cols},${thumbW}px)">${imgs}</body>`,
    { waitUntil: 'load' }
  );
  await sheet.screenshot({ path: path.join(outDir, 'contact-sheet.png'), type: 'png' });
  await sheet.close();
} finally {
  await browser.close();
}

// ── Verifikasi dimensi dari header PNG, bukan dari niat ──────────────────────
const files = (await readdir(outDir)).filter((f) => /^slide-\d+\.png$/.test(f));
for (const r of slideResults) {
  const buf = await readFile(path.join(outDir, r.file));
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const ok = w === W && h === H;
  r.checks.dimensions = { ok, measured: `${w}x${h}` };
  if (!ok) r.passed = false;
  r.sha256 = createHash('sha256').update(buf).digest('hex');
}

const report = {
  renderedAt: new Date().toISOString(),
  renderer: { engine: 'playwright-chromium', version: '1.56.0' },
  canvas: { width: W, height: H },
  slideCount: total,
  pngCount: files.length,
  passed: slideResults.every((s) => s.passed) && files.length === total,
  thresholds: { minFontPx, minContrastRatio: minContrast },
  slides: slideResults.map(({ sha256, ...rest }) => rest),
};

await writeFile(path.join(outDir, 'visual-qa.json'), JSON.stringify(report, null, 2), 'utf8');
await writeFile(path.join(outDir, 'fonts.json'), JSON.stringify([...fontsUsed].sort(), null, 2), 'utf8');
await writeFile(
  path.join(outDir, 'hashes.json'),
  JSON.stringify(Object.fromEntries(slideResults.map((s) => [s.file, s.sha256])), null, 2),
  'utf8'
);

console.log(`\nRender selesai: ${outDir}`);
console.log(`  slide     : ${total}`);
console.log(`  PNG       : ${files.length}`);
console.log(`  kanvas    : ${W}x${H}`);
for (const s of slideResults) {
  const bad = Object.entries(s.checks)
    .filter(([, c]) => !c.ok)
    .map(([k]) => k);
  console.log(`  slide ${String(s.index).padStart(2, '0')} ${s.template.padEnd(11)} ${s.passed ? 'LULUS' : 'GAGAL: ' + bad.join(', ')}`);
}
console.log(`\nvisual-qa.json passed = ${report.passed}`);

if (!report.passed) process.exit(3);
