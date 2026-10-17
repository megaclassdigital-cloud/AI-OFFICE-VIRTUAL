#!/usr/bin/env node
// normalize-design-slots.mjs — memperbaiki salah ketik nama slot yang MIRIP di carousel-design.json (mis. "sources" untuk slot template "source").
// Murni mekanis dan tanpa kehilangan isi: kunci slot yang tidak dikenal hanya diganti namanya bila tepat SATU slot template yang belum terisi sama bentuknya
// (huruf kecil, tanpa akhiran "s"/"_"/"-"). Yang ambigu atau tidak mirip dibiarkan (tetap ditolak validasi desain). Nilai tidak pernah diubah.
// Pemakaian: node scripts/normalize-design-slots.mjs EDU-117 [--dry]
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJ = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, ''));
const shape = (k) => String(k).toLowerCase().replace(/[_-]/g, '').replace(/s$/, '');

/** Murni. design = carousel-design.json, templates = isi templates.json (dengan atau tanpa pembungkus "templates"). Mengembalikan { design, renames:[{slide,from,to}] }. */
export function normalizeSlots(design, templates) {
  const defs = templates?.templates ?? templates ?? {};
  const renames = [];
  const out = { ...design, slides: (design?.slides ?? []).map((sl) => {
    const known = Object.keys(defs[sl.template]?.slots ?? {});
    if (!known.length || !sl.slots) return sl;
    const slots = { ...sl.slots };
    for (const k of Object.keys(sl.slots)) {
      if (known.includes(k)) continue;
      const cands = known.filter((c) => !(c in slots) && shape(c) === shape(k));
      if (cands.length === 1) { slots[cands[0]] = slots[k]; delete slots[k]; renames.push({ slide: sl.index, from: k, to: cands[0] }); }
    }
    return { ...sl, slots };
  }) };
  return { design: out, renames };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const id = process.argv.slice(2).find((x) => /^EDU-[0-9]+/.test(x));
  if (!id) { console.error('Pakai: node scripts/normalize-design-slots.mjs EDU-n [--dry]'); process.exit(1); }
  const file = path.join(ROOT, 'workspace', 'agent', 'runs', ...id.split('/'), 'carousel-design.json');
  const { design, renames } = normalizeSlots(readJ(file), readJ(path.join(ROOT, 'divisions', 'edukasiai', 'brand', 'templates.json')));
  if (!renames.length) { console.log('tidak ada nama slot yang perlu dirapikan'); process.exit(0); }
  console.log(`rapikan: ${renames.map((r) => `slide ${r.slide} "${r.from}" -> "${r.to}"`).join('; ')}`);
  if (!process.argv.includes('--dry')) { copyFileSync(file, file + '.bak-slot'); writeFileSync(file, JSON.stringify(design, null, 2) + '\n'); console.log('tersimpan (cadangan: carousel-design.json.bak-slot)'); }
}
