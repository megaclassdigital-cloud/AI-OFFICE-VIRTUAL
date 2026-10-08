#!/usr/bin/env node
// check-carousel.mjs — cek deterministik draf Copywriter (F1.5).
//
// Ditegakkan KODE, bukan LLM:
//   - lolos skema carousel (6-10 slide, caption, hashtag, sumber ber-URL)
//   - semua sumber adalah kandidat "verified" dan URL-nya sama persis dengan hasil Verifier
//   - setiap slide berisi klaim (selain cta) memiliki sourceRefs, semuanya ada di daftar sources
//   - panjang heading/body muat dalam batas slot template brand (templates.json)
//   - kata tekanan benar-benar ada di teks slide
//   - (opsional, bila riset diberikan) setiap angka di teks slide muncul di judul/ringkasan/tanggal sumber yang dikutip
//
// Pemakaian: node scripts/check-carousel.mjs <carousel.json> <verification-result.json> [research-output.json]

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../schemas/validate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, ''));

// Peran slide -> slot template yang menampung heading dan body.
export const ROLE_SLOTS = {
  hook: { template: 'cover', heading: ['hook'], body: ['subtitle'] },
  point: { template: 'point', heading: ['heading'], body: ['body'] },
  stat: { template: 'stat', heading: ['value'], body: ['context'] },
  quote: { template: 'quote', heading: ['quote'], body: ['attribution'] },
  comparison: { template: 'comparison', heading: ['heading'], body: ['leftBody', 'rightBody'] },
  cta: { template: 'cta', heading: ['heading'], body: ['body'] },
};
const NO_SOURCE_NEEDED = new Set(['cta']);

export function loadTemplates() {
  const t = readJson(path.join(root, 'divisions', 'edukasiai', 'brand', 'templates.json'));
  return t.templates ?? t;
}

const numbersIn = (s) => (String(s).match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(',', '.'));

/** @returns {{ok:boolean, errors:string[]}} */
export function checkCarousel(carousel, verification, { research, templates = loadTemplates() } = {}) {
  const schema = validate('carousel', carousel);
  if (!schema.ok) return { ok: false, errors: schema.errors.map((e) => `skema: ${e.path || '/'} ${e.message}`) };
  const errors = [];
  const vr = validate('verification-result', verification);
  if (!vr.ok) return { ok: false, errors: ['verification-result tidak valid; draf tidak dapat diperiksa'] };

  const verified = new Map(verification.results.filter((r) => r.status === 'verified').map((r) => [r.candidateId, r]));
  const listed = new Set();
  for (const s of carousel.sources) {
    const v = verified.get(s.candidateId);
    if (!v) errors.push(`sumber ${s.candidateId} tidak berstatus verified`);
    else if (v.url !== s.url) errors.push(`URL sumber ${s.candidateId} (${s.url}) berbeda dari hasil Verifier (${v.url})`);
    if (listed.has(s.candidateId)) errors.push(`sumber ${s.candidateId} terdaftar dua kali`);
    listed.add(s.candidateId);
  }

  const byId = research ? Object.fromEntries(research.candidates.map((c) => [c.id, c])) : null;

  carousel.slides.forEach((sl, i) => {
    const at = `slide ${sl.index}`;
    if (sl.index !== i + 1) errors.push(`${at}: urutan index harus ${i + 1}`);
    const refs = sl.sourceRefs ?? [];
    if (!NO_SOURCE_NEEDED.has(sl.role) && refs.length === 0) errors.push(`${at} (${sl.role}): klaim tanpa sourceRefs`);
    for (const r of refs) {
      if (!verified.has(r)) errors.push(`${at}: sourceRefs ${r} tidak berstatus verified`);
      else if (!listed.has(r)) errors.push(`${at}: sourceRefs ${r} tidak ada di daftar sources`);
    }

    const map = ROLE_SLOTS[sl.role];
    const tpl = templates[map.template];
    const limit = (names) => names.reduce((sum, n) => sum + (tpl.slots[n]?.maxChars ?? 0), 0);
    if (sl.heading.length > limit(map.heading)) errors.push(`${at}: heading ${sl.heading.length} karakter melebihi batas ${limit(map.heading)} (${map.template}.${map.heading.join('+')})`);
    if (sl.body.length > limit(map.body)) errors.push(`${at}: body ${sl.body.length} karakter melebihi batas ${limit(map.body)} (${map.template}.${map.body.join('+')})`);

    for (const w of sl.emphasis ?? []) {
      if (!`${sl.heading} ${sl.body}`.includes(w)) errors.push(`${at}: kata tekanan "${w}" tidak ada di teks slide`);
    }

    if (byId) {
      const corpus = refs.map((r) => byId[r]).filter(Boolean)
        .map((c) => `${c.title} ${c.summary} ${c.published_at}`).join(' ');
      const have = new Set(numbersIn(corpus).map((n) => String(Number(n))));
      for (const n of numbersIn(`${sl.heading} ${sl.body}`)) {
        if (!have.has(String(Number(n)))) errors.push(`${at}: angka "${n}" tidak ditemukan di sumber yang dikutip`);
      }
    }
  });

  return { ok: errors.length === 0, errors };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [c, v, r] = process.argv.slice(2);
  if (!c || !v) { console.error('Pemakaian: node scripts/check-carousel.mjs <carousel.json> <verification-result.json> [research-output.json]'); process.exit(64); }
  const res = checkCarousel(readJson(c), readJson(v), { research: r ? readJson(r) : undefined });
  for (const e of res.errors) console.error(`GAGAL: ${e}`);
  if (res.ok) console.log('OK');
  process.exit(res.ok ? 0 : 2);
}
