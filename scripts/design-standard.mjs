// design-standard.mjs — mencocokkan carousel-design.json dengan PATOKAN DESAIN (divisions/edukasiai/brand/design-standard.json).
// Murni dan deterministik (tanpa LLM, tanpa I/O pada fungsi pemeriksa). CLI membangun ulang gambar acuan dari reference/patokan-design.json.
//   node scripts/design-standard.mjs --build-reference     render patokan-design.json -> reference/patokan-contact-sheet.png
import { readFileSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const STANDARD_FILE = path.join(root, 'divisions', 'edukasiai', 'brand', 'design-standard.json');
export const loadStandard = () => JSON.parse(readFileSync(STANDARD_FILE, 'utf8').replace(/^﻿/, ''));

export function familyOf(template, std) {
  for (const [name, list] of Object.entries(std.family)) if (Array.isArray(list) && list.includes(template)) return name;
  return 'neutral';
}

/**
 * @param design   carousel-design.json
 * @param carousel carousel.json (opsional; untuk peran slide)
 * @param std      isi design-standard.json
 * @param opts     { defaultVariant } varian bawaan brand bila slide tidak menyebut colorVariant
 * @returns {{ ok:boolean, errors:string[] }}
 */
export function checkStandard(design, carousel, std, { defaultVariant = 'editorial', allowLegacy = true } = {}) {
  const errors = [];
  const slides = Array.isArray(design?.slides) ? design.slides : [];
  if (!slides.length) return { ok: false, errors: ['patokan: carousel-design.json tanpa slide'] };

  // 1) satu varian warna per carousel, dari daftar yang sah
  const variants = slides.map((s) => s.colorVariant ?? defaultVariant);
  const used = [...new Set(variants)];
  if (std.variant?.uniformPerCarousel && used.length > 1) errors.push(`patokan: varian warna harus SAMA di semua slide, ditemukan: ${used.join(', ')}`);
  const okVariants = [...(std.variant?.allowed ?? []), ...(allowLegacy ? (std.variant?.legacy ?? []) : [])];
  for (const v of used) if (okVariants.length && !okVariants.includes(v)) errors.push(`patokan: varian "${v}" tidak ada di daftar patokan (${okVariants.join(', ')})`);

  // 2) pembuka dan penutup sekeluarga template
  const first = slides[0]; const last = slides[slides.length - 1];
  const f1 = familyOf(first.template, std); const f2 = familyOf(last.template, std);
  if (f1 !== 'neutral' && f2 !== 'neutral' && f1 !== f2) errors.push(`patokan: slide pembuka (${first.template}, keluarga ${f1}) dan penutup (${last.template}, keluarga ${f2}) harus sekeluarga`);

  // 3) struktur dan peran
  const st = std.structure ?? {};
  if (st.minSlides && slides.length < st.minSlides) errors.push(`patokan: minimal ${st.minSlides} slide (ada ${slides.length})`);
  if (st.maxSlides && slides.length > st.maxSlides) errors.push(`patokan: maksimal ${st.maxSlides} slide (ada ${slides.length})`);
  const cs = Array.isArray(carousel?.slides) ? carousel.slides : [];
  if (cs.length) {
    if (st.firstRole && cs[0].role !== st.firstRole) errors.push(`patokan: slide pertama harus berperan ${st.firstRole} (ada ${cs[0].role})`);
    if (st.lastRole && cs[cs.length - 1].role !== st.lastRole) errors.push(`patokan: slide terakhir harus berperan ${st.lastRole} (ada ${cs[cs.length - 1].role})`);
  }

  // 4) penekanan
  const maxE = std.emphasis?.maxPerSlide;
  if (maxE) for (const s of slides) if ((s.emphasis ?? []).length > maxE) errors.push(`patokan: slide ${s.index} memiliki ${(s.emphasis ?? []).length} kata penekanan (maks ${maxE})`);

  return { ok: errors.length === 0, errors };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--build-reference')) {
  const std = loadStandard();
  const design = path.join(root, std.referenceDesign);
  const out = path.join(root, 'workspace', 'tmp-reference-render');
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'render.mjs'), '--design', design, '--out', out], { encoding: 'utf8', timeout: 240_000 });
  if (r.status !== 0) { console.error((r.stderr || r.stdout || '').slice(-600)); process.exit(1); }
  const dest = path.join(root, std.referenceSheet);
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(path.join(out, 'contact-sheet.png'), dest);
  console.log('Gambar acuan dibuat:', dest);
}
