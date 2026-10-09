#!/usr/bin/env node
// check-design.mjs — cek deterministik "fakta tidak berubah" untuk keluaran Designer (F1.7, AC1.7).
//
// Designer hanya boleh memilih template dan memendekkan teks. KODE memeriksa:
//   - lolos skema carousel-design; jumlah dan urutan slide sama dengan carousel.json
//   - template sesuai peran slide (hook->cover, point->point, stat->stat, ...)
//   - setiap ANGKA di slot (persentase, tanggal, nilai) ada di teks slide yang sama di carousel
//       (pengecualian: slot `number` = nomor urut tampilan)
//   - setiap NAMA DIRI/akronim di slot ada di carousel (teks semua slide, nama sumber) atau nama merek
//       (pengecualian: slot `kicker`, label dekoratif)
//
// Pemakaian: node scripts/check-design.mjs <carousel-design.json> <carousel.json>

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../schemas/validate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, ''));
const TEMPLATES = (() => { try { return readJson(path.join(root, 'divisions', 'edukasiai', 'brand', 'templates.json')).templates; } catch { return {}; } })();

export const ROLE_TO_TEMPLATE = { hook: 'cover', point: 'point', stat: 'stat', quote: 'quote', comparison: 'comparison', cta: 'cta' };
// Template yang sah per peran slide (format foto/ikon v3 menambah pilihan; peran tetap menentukan keluarga template).
export const ROLE_TEMPLATES = {
  hook: ['cover', 'hero-cover'],
  point: ['point', 'hero-explain', 'compare-cards', 'flow', 'icon-list'],
  stat: ['stat'],
  quote: ['quote'],
  comparison: ['comparison', 'compare-cards'],
  cta: ['cta', 'hero-cta'],
};
const IMAGE_PATH_RE = /^(runs\/EDU-[0-9]+(?:\/revision-[0-9]+)?\/assets\/[A-Za-z0-9._-]+\.(png|jpe?g|webp)|brand\/[A-Za-z0-9._\/-]+\.(png|jpe?g|webp))$/;
const NUMBER_EXEMPT_SLOTS = new Set(['number']);
const NAME_EXEMPT_SLOTS = new Set(['kicker']);

const numbersIn = (s) => (String(s).match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => String(Number(n.replace(',', '.'))));

/** Nama diri/akronim: kata berawalan huruf kapital yang BUKAN kata pertama sebuah kalimat/slot, plus akronim 2+ huruf kapital. */
export function properNamesIn(text) {
  const names = new Set();
  const sentences = String(text).split(/(?<=[.!?])\s+|\n+/);
  for (const sent of sentences) {
    const words = sent.match(/[A-Za-z][A-Za-z0-9]*/g) ?? [];
    words.forEach((w, i) => {
      if (/^[A-Z]{2,}$/.test(w) || /^[A-Z][a-z]+[A-Z]/.test(w)) names.add(w); // AI, CTA, EdukasiAI
      else if (i > 0 && /^[A-Z][a-z]{2,}$/.test(w)) names.add(w); // Gavin, Newsom, Sep
    });
  }
  return [...names];
}

/** @returns {{ok:boolean, errors:string[]}} */
export function checkDesign(design, carousel, { brandName = 'EdukasiAI' } = {}) {
  const sd = validate('carousel-design', design);
  if (!sd.ok) return { ok: false, errors: sd.errors.map((e) => `skema: ${e.path || '/'} ${e.message}`) };
  const sc = validate('carousel', carousel);
  if (!sc.ok) return { ok: false, errors: ['carousel.json tidak valid; desain tidak dapat diperiksa'] };

  const errors = [];
  if (design.slides.length !== carousel.slides.length) {
    errors.push(`jumlah slide desain (${design.slides.length}) berbeda dari carousel (${carousel.slides.length})`);
  }

  const allText = carousel.slides.map((s) => `${s.heading} ${s.body}`).join(' ');
  const sourceNames = carousel.sources.map((s) => s.source_name).join(' ');
  const namePool = new Set([...properNamesIn(`x ${allText}`), ...properNamesIn(`x ${sourceNames}`), ...allText.match(/[A-Za-z][A-Za-z0-9]*/g) ?? [], brandName]);
  // Singkatan yang merupakan inisial nama berkata-banyak di carousel/sumber (Associated Press -> AP) tidak mengubah fakta.
  for (const phrase of `${sourceNames} ${allText}`.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/g) ?? []) {
    namePool.add(phrase.split(/\s+/).map((w) => w[0]).join(''));
  }
  const poolLower = new Set([...namePool].map((n) => n.toLowerCase()));

  design.slides.forEach((d, i) => {
    const c = carousel.slides[i];
    if (!c) return;
    const at = `slide ${d.index}`;
    if (d.index !== c.index) errors.push(`${at}: index tidak sama dengan carousel (${c.index})`);
    const allowed = ROLE_TEMPLATES[c.role] ?? [ROLE_TO_TEMPLATE[c.role]];
    if (!allowed.includes(d.template)) errors.push(`${at}: template "${d.template}" tidak sesuai peran ${c.role} (boleh: ${allowed.join(', ')})`);

    const slideNums = new Set(numbersIn(`${c.heading} ${c.body}`));
    for (const [slot, value] of Object.entries(d.slots)) {
      const kind = TEMPLATES[d.template]?.slots?.[slot]?.type;
      if (kind === 'icon') continue; // nama ikon dari set lokal; keberadaannya diperiksa renderer
      if (kind === 'image') { if (!IMAGE_PATH_RE.test(String(value))) errors.push(`${at}: gambar "${value}" di slot ${slot} harus berupa runs/<ID>/assets/<berkas> atau brand/<berkas>`); continue; }
      if (slot === 'source') {
        const m = String(value).match(/^(?:Sumber:\s*)?(.+)$/);
        const known = carousel.sources.map((s) => String(s.source_name).toLowerCase());
        const acro = (n) => n.split(/s+/).map((w) => w[0]).join('');
        known.push(...known.map(acro)); // singkatan (AP untuk Associated Press) diizinkan
        if (!m || !m[1].split(/\s*,\s*/).every((n) => known.includes(n.toLowerCase()))) errors.push(`${at}: slot source harus \"[Sumber: ]<nama media dari daftar sumber carousel>" (dapat: ${[...new Set(known)].join(', ')})`);
        continue;
      }
      if (!NUMBER_EXEMPT_SLOTS.has(slot)) {
        for (const n of numbersIn(value)) {
          if (!slideNums.has(n)) errors.push(`${at}: angka "${n}" di slot ${slot} tidak ada di teks slide carousel`);
        }
      }
      if (!NAME_EXEMPT_SLOTS.has(slot)) {
        for (const name of properNamesIn(value)) {
          if (!poolLower.has(name.toLowerCase())) errors.push(`${at}: nama "${name}" di slot ${slot} tidak ada di carousel`);
        }
      }
    }
  });
  return { ok: errors.length === 0, errors };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [dFile, cFile] = process.argv.slice(2);
  if (!dFile || !cFile) { console.error('Pemakaian: node scripts/check-design.mjs <carousel-design.json> <carousel.json>'); process.exit(64); }
  const brand = readJson(path.join(root, 'divisions', 'edukasiai', 'brand', 'brand.json'));
  const r = checkDesign(readJson(dFile), readJson(cFile), { brandName: brand.logo?.text ?? 'EdukasiAI' });
  for (const e of r.errors) console.error(`GAGAL: ${e}`);
  if (r.ok) console.log('OK');
  process.exit(r.ok ? 0 : 2);
}
