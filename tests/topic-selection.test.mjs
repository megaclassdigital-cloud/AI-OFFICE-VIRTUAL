// Test validasi deterministik pemilihan topik (F1.4): alasan wajib, hanya kandidat terverifikasi.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { checkTopicSelection, totalOf } from '../scripts/check-topic-selection.mjs';
import { repoRoot } from './helpers.mjs';

const verification = JSON.parse(readFileSync(path.join(repoRoot, 'fixtures', 'golden', 'valid', '02-verification-result.json'), 'utf8'));
// golden: c01-c05 verified, c06 rejected
const clone = (o) => JSON.parse(JSON.stringify(o));
const s = (relevance, novelty, impact) => ({ relevance, novelty, impact });

const base = () => ({
  selectedAt: '2026-10-08T01:30:00Z',
  ranking: [
    { candidateId: 'c01', scores: s(4, 5, 4) },
    { candidateId: 'c02', scores: s(3, 3, 3) },
    { candidateId: 'c03', scores: s(2, 4, 3) },
  ],
  selected: { candidateId: 'c01', reason: 'Skor tertinggi (13) dan langsung relevan untuk pekerja Indonesia di perusahaan global.' },
});

describe('checkTopicSelection', () => {
  it('pilihan sah: ok, total dihitung kode, tanpa peringatan', () => {
    const r = checkTopicSelection(base(), verification);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.totals).toEqual({ c01: 13, c02: 9, c03: 9 });
    expect(r.topCandidateIds).toEqual(['c01']);
  });

  it('menolak pilihan tanpa alasan', () => {
    const d = base();
    d.selected.reason = '';
    const r = checkTopicSelection(d, verification);
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/skema/);
  });

  it('menolak memilih kandidat yang rejected (c06) walau skornya tertinggi', () => {
    const d = base();
    d.ranking.push({ candidateId: 'c06', scores: s(5, 5, 5) });
    d.selected = { candidateId: 'c06', reason: 'Skor sempurna 15 dan sangat relevan bagi pembaca.' };
    const r = checkTopicSelection(d, verification);
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/c06 tidak berstatus verified/);
  });

  it('menolak kandidat yang tidak ada di verification-result', () => {
    const d = base();
    d.ranking.push({ candidateId: 'c09', scores: s(3, 3, 3) });
    expect(checkTopicSelection(d, verification).errors.join()).toMatch(/c09 tidak berstatus verified/);
  });

  it('menolak terpilih yang tidak ada di ranking', () => {
    const d = base();
    d.selected.candidateId = 'c04';
    expect(checkTopicSelection(d, verification).errors.join()).toMatch(/c04 tidak ada di ranking/);
  });

  it('menolak kandidat dinilai dua kali', () => {
    const d = base();
    d.ranking.push({ candidateId: 'c02', scores: s(5, 5, 5) });
    expect(checkTopicSelection(d, verification).errors.join()).toMatch(/c02 dinilai dua kali/);
  });

  it('memilih bukan yang tertinggi: tetap ok tetapi diberi peringatan untuk owner', () => {
    const d = base();
    d.selected = { candidateId: 'c02', reason: 'Lebih mudah dijelaskan ke pemula meski skor lebih rendah dari c01.' };
    const r = checkTopicSelection(d, verification);
    expect(r.ok).toBe(true);
    expect(r.warnings.join()).toMatch(/bukan yang tertinggi/);
  });

  it('seri nilai tertinggi: tidak ada peringatan untuk salah satu pemenang', () => {
    const d = base();
    d.ranking[1].scores = s(4, 5, 4);
    d.selected = { candidateId: 'c02', reason: 'Seri dengan c01; dipilih karena sumbernya lebih mudah diverifikasi.' };
    const r = checkTopicSelection(d, verification);
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it('skor LLM tidak dipercaya: total tidak bisa disuntik lewat skema', () => {
    const d = base();
    d.ranking[0].total = 99;
    expect(checkTopicSelection(d, verification).ok).toBe(false);
  });

  it('verification-result rusak -> gagal, bukan lolos diam-diam', () => {
    const v = clone(verification);
    delete v.results[0].checks;
    expect(checkTopicSelection(base(), v).ok).toBe(false);
  });
});

describe('rubrik', () => {
  it('totalOf menjumlahkan tiga kriteria', () => {
    expect(totalOf(s(1, 2, 3))).toBe(6);
  });
  it('dokumen rubrik memuat tiga kriteria dan aturan kandidat terverifikasi', () => {
    const md = readFileSync(path.join(repoRoot, 'divisions', 'edukasiai', 'sop', 'topic-rubric.md'), 'utf8');
    for (const k of ['Relevansi Indonesia', 'Kebaruan', 'Dampak', '`verified`']) expect(md).toContain(k);
  });
});
