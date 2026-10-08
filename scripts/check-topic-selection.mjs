#!/usr/bin/env node
// check-topic-selection.mjs — validasi deterministik pemilihan topik (F1.4).
//
// Aturan yang ditegakkan KODE (bukan LLM):
//   - dokumen lolos skema topic-selection (skor bulat 1-5, alasan wajib tidak kosong)
//   - hanya kandidat berstatus "verified" di verification-result yang boleh dinilai/dipilih
//   - yang dipilih harus ada di ranking; tidak boleh ada kandidat ganda
//   - total skor dihitung di sini; bila yang dipilih bukan tertinggi, dikembalikan sebagai peringatan
//
// Pemakaian: node scripts/check-topic-selection.mjs <topic-selection.json> <verification-result.json>

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../schemas/validate.mjs';

const readJson = (f) => JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, ''));
export const totalOf = (s) => s.relevance + s.novelty + s.impact;

/** @returns {{ok:boolean, errors:string[], warnings:string[], totals:Record<string,number>, topCandidateIds:string[]}} */
export function checkTopicSelection(selection, verification) {
  const errors = [];
  const warnings = [];
  const schema = validate('topic-selection', selection);
  if (!schema.ok) {
    return { ok: false, errors: schema.errors.map((e) => `skema: ${e.path || '/'} ${e.message}`), warnings, totals: {}, topCandidateIds: [] };
  }
  const vr = validate('verification-result', verification);
  if (!vr.ok) errors.push('verification-result tidak valid; pemilihan tidak dapat diperiksa');

  const verified = new Set((verification?.results ?? []).filter((r) => r.status === 'verified').map((r) => r.candidateId));
  const seen = new Set();
  const totals = {};
  for (const r of selection.ranking) {
    if (seen.has(r.candidateId)) errors.push(`kandidat ${r.candidateId} dinilai dua kali`);
    seen.add(r.candidateId);
    if (!verified.has(r.candidateId)) errors.push(`kandidat ${r.candidateId} tidak berstatus verified; tidak boleh dinilai`);
    totals[r.candidateId] = totalOf(r.scores);
  }
  const chosen = selection.selected.candidateId;
  if (!seen.has(chosen)) errors.push(`kandidat terpilih ${chosen} tidak ada di ranking`);
  if (!verified.has(chosen)) errors.push(`kandidat terpilih ${chosen} tidak berstatus verified`);

  const max = Math.max(...Object.values(totals));
  const top = Object.keys(totals).filter((id) => totals[id] === max);
  if (seen.has(chosen) && totals[chosen] < max) {
    warnings.push(`kandidat terpilih ${chosen} (skor ${totals[chosen]}) bukan yang tertinggi (${top.join(', ')} = ${max}); owner perlu meninjau alasannya`);
  }
  return { ok: errors.length === 0, errors, warnings, totals, topCandidateIds: top };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [selFile, verFile] = process.argv.slice(2);
  if (!selFile || !verFile) { console.error('Pemakaian: node scripts/check-topic-selection.mjs <topic-selection.json> <verification-result.json>'); process.exit(64); }
  const r = checkTopicSelection(readJson(selFile), readJson(verFile));
  for (const e of r.errors) console.error(`GAGAL: ${e}`);
  for (const w of r.warnings) console.error(`PERINGATAN: ${w}`);
  if (r.ok) console.log(`OK. Total skor: ${JSON.stringify(r.totals)}`);
  process.exit(r.ok ? 0 : 2);
}
