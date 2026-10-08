#!/usr/bin/env node
// qa-deterministic.mjs — QA deterministik gabungan (F1.9a).
//
// Menjalankan SEMUA cek yang bisa dihitung kode dan mengeluarkan laporan lulus/gagal per slide:
//   teks   : check-carousel (sumber verified, sourceRefs, panjang slot, angka) + check-topic-selection (opsional)
//   desain : check-design (fakta tidak berubah, template sesuai peran)
//   visual : visual-qa.json hasil renderer (dimensi, overflow, ukuran font, kontras, batas slot)
// Penilaian yang butuh bahasa (nada, kejelasan) bukan di sini; itu bagian agent QA (F1.9b).
//
// Routing perbaikan (dipakai F1.9b): gagal teks -> copywriter, gagal desain/visual -> designer.
//
// Pemakaian: node scripts/qa-deterministic.mjs --carousel f --verification f --design f --visual-qa f [--research f] [--topic f]

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../schemas/validate.mjs';
import { checkCarousel } from './check-carousel.mjs';
import { checkDesign } from './check-design.mjs';
import { checkTopicSelection } from './check-topic-selection.mjs';

const readJson = (f) => JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, ''));
const slideOf = (msg) => {
  const m = /^slide (\d+)\b/.exec(msg);
  return m ? Number(m[1]) : null;
};
const stripSlidePrefix = (msg) => msg.replace(/^slide \d+(?: \([a-z]+\))?:?\s*/, '');

/**
 * @param {object} input { carousel, verification, design, visualQa, research?, topicSelection? }
 * @returns {{passed:boolean, routeTo:string[], global:{text:string[],design:string[],visual:string[]}, slides:object[], summary:object}}
 */
export function runQa({ carousel, verification, design, visualQa, research, topicSelection }) {
  const global = { text: [], design: [], visual: [] };
  const per = new Map(); // index -> {text:[], design:[], visual:[]}
  const bucket = (i) => {
    if (!per.has(i)) per.set(i, { text: [], design: [], visual: [] });
    return per.get(i);
  };
  const route = (kind, errors) => {
    for (const e of errors) {
      const i = slideOf(e);
      if (i === null) global[kind].push(e);
      else bucket(i)[kind].push(stripSlidePrefix(e));
    }
  };

  route('text', checkCarousel(carousel, verification, { research }).errors);
  if (topicSelection) route('text', checkTopicSelection(topicSelection, verification).errors.map((e) => `topik: ${e}`));
  route('design', checkDesign(design, carousel).errors);

  const vq = validate('visual-qa', visualQa);
  if (!vq.ok) {
    global.visual.push(...vq.errors.map((e) => `laporan visual tidak valid: ${e.path || '/'} ${e.message}`));
  } else {
    if (visualQa.slideCount !== carousel.slides.length) {
      global.visual.push(`jumlah slide dirender (${visualQa.slideCount}) berbeda dari carousel (${carousel.slides.length})`);
    }
    if (visualQa.pngCount !== visualQa.slideCount) global.visual.push(`jumlah PNG (${visualQa.pngCount}) berbeda dari jumlah slide (${visualQa.slideCount})`);
    for (const s of visualQa.slides) {
      for (const [name, c] of Object.entries(s.checks)) {
        if (!c.ok) bucket(s.index).visual.push(`${name}${c.measured ? ` (${c.measured})` : ''}${c.detail ? `: ${JSON.stringify(c.detail)}` : ''}`);
      }
      if (!s.passed && bucket(s.index).visual.length === 0) bucket(s.index).visual.push('slide ditandai gagal oleh renderer');
    }
  }

  const slides = carousel.slides.map((c) => {
    const b = per.get(c.index) ?? { text: [], design: [], visual: [] };
    return { index: c.index, role: c.role, passed: !b.text.length && !b.design.length && !b.visual.length, text: b.text, design: b.design, visual: b.visual };
  });

  const failedText = global.text.length > 0 || slides.some((s) => s.text.length);
  const failedDesign = global.design.length > 0 || slides.some((s) => s.design.length);
  const failedVisual = global.visual.length > 0 || slides.some((s) => s.visual.length);
  const routeTo = [];
  if (failedText) routeTo.push('copywriter');
  if (failedDesign || failedVisual) routeTo.push('designer');

  return {
    passed: !failedText && !failedDesign && !failedVisual,
    routeTo,
    global,
    slides,
    summary: { slides: slides.length, passedSlides: slides.filter((s) => s.passed).length, failedText, failedDesign, failedVisual },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const arg = (n) => (a.includes(n) ? a[a.indexOf(n) + 1] : undefined);
  const need = ['--carousel', '--verification', '--design', '--visual-qa'].filter((n) => !arg(n));
  if (need.length) { console.error(`Pemakaian: node scripts/qa-deterministic.mjs --carousel f --verification f --design f --visual-qa f [--research f] [--topic f]\nKurang: ${need.join(', ')}`); process.exit(64); }
  const rep = runQa({
    carousel: readJson(arg('--carousel')), verification: readJson(arg('--verification')), design: readJson(arg('--design')),
    visualQa: readJson(arg('--visual-qa')), research: arg('--research') ? readJson(arg('--research')) : undefined,
    topicSelection: arg('--topic') ? readJson(arg('--topic')) : undefined,
  });
  console.log(JSON.stringify(rep, null, 2));
  process.exit(rep.passed ? 0 : 2);
}
