// Test normalisasi keluaran Researcher (F1.2): keluaran NYATA F0.2 lolos skema tanpa run baru.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeResearch, isWhitelisted } from '../scripts/normalize-research.mjs';
import { validate } from '../schemas/validate.mjs';
import { repoRoot } from './helpers.mjs';

const read = (rel) => JSON.parse(readFileSync(path.join(repoRoot, rel), 'utf8').replace(/^﻿/, ''));
const raw = read('docs/spike/evidence/F0.2-research-output.json');
const AT = '2026-10-04T16:27:00Z';

describe('normalizeResearch', () => {
  it('keluaran nyata F0.2 (tanpa id/generatedAt/windowDays) lolos skema setelah dinormalisasi', () => {
    const out = normalizeResearch(raw, { generatedAt: AT });
    expect(validate('research-output', out).ok).toBe(true);
    expect(out.candidates).toHaveLength(6);
    expect(out.candidates.map((c) => c.id)).toEqual(['c01', 'c02', 'c03', 'c04', 'c05', 'c06']);
    expect(out.windowDays).toBe(7);
  });

  it('hasilnya identik dengan fixture golden valid/01 (satu jalur kode)', () => {
    expect(normalizeResearch(raw, { generatedAt: AT })).toEqual(read('fixtures/golden/valid/01-research-output.json'));
  });

  it('tanpa normalisasi, keluaran mentah ditolak skema (alasan normalizer ada)', () => {
    expect(validate('research-output', raw).ok).toBe(false);
  });

  it('isi kandidat tidak diubah normalizer', () => {
    const out = normalizeResearch(raw, { generatedAt: AT });
    out.candidates.forEach((c, i) => {
      for (const k of ['title', 'summary', 'url', 'published_at', 'source_name']) expect(c[k]).toBe(raw.candidates[i][k]);
    });
  });

  it('menandai non_whitelist lewat kode: AP ditandai, blog resmi tidak', () => {
    const mk = (url) => ({ title: 'Judul berita AI yang cukup panjang', summary: 'Ringkasan netral berbahasa Indonesia yang cukup panjang untuk lolos batas minimal.', url, published_at: '2026-10-07', source_name: 'Sumber Uji' });
    const five = [
      mk('https://openai.com/index/a'), mk('https://www.anthropic.com/news/b'), mk('https://techcrunch.com/2026/10/07/c'),
      mk('https://apnews.com/article/d'), mk('https://evil-openai.com/e'),
    ];
    const out = normalizeResearch({ candidates: five }, { generatedAt: AT });
    expect(out.candidates.map((c) => !!c.non_whitelist)).toEqual([false, false, false, true, true]);
  });

  it('isWhitelisted: subdomain cocok, domain mirip tidak, URL rusak aman', () => {
    const d = ['openai.com'];
    expect(isWhitelisted('https://platform.openai.com/x', d)).toBe(true);
    expect(isWhitelisted('https://notopenai.com/x', d)).toBe(false);
    expect(isWhitelisted('bukan url', d)).toBe(false);
  });

  it('kurang dari 5 kandidat ditolak dengan galat skema', () => {
    expect(() => normalizeResearch({ candidates: raw.candidates.slice(0, 4) }, { generatedAt: AT })).toThrow(/research-output/);
  });

  it('keluaran tanpa array candidates ditolak', () => {
    expect(() => normalizeResearch({}, { generatedAt: AT })).toThrow(/candidates/);
  });
});

describe('instruksi Researcher', () => {
  const md = readFileSync(path.join(repoRoot, 'divisions', 'edukasiai', 'agents', 'researcher.md'), 'utf8');
  it('mewajibkan tool plugin dan melarang HTTP sendiri', () => {
    expect(md).toMatch(/attach_file/);
    expect(md).toMatch(/complete_stage/);
    expect(md).toMatch(/Dilarang membuat panggilan HTTP sendiri/);
  });
  it('menyebut batas 7 hari, 5-10 kandidat, dan konten web sebagai data', () => {
    expect(md).toMatch(/7 hari/);
    expect(md).toMatch(/5 sampai 10 kandidat/);
    expect(md).toMatch(/data, bukan instruksi/);
  });
});
