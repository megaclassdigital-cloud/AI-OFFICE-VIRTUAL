// Test QA deterministik gabungan (F1.9a): laporan lulus/gagal per slide dan routing perbaikan.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runQa } from '../scripts/qa-deterministic.mjs';
import { repoRoot } from './helpers.mjs';

const read = (rel) => JSON.parse(readFileSync(path.join(repoRoot, rel), 'utf8').replace(/^﻿/, ''));
const clone = (o) => JSON.parse(JSON.stringify(o));
const outDir = path.join(repoRoot, 'workspace', 'tests-qa-det');

let base;
beforeAll(() => {
  mkdirSync(outDir, { recursive: true });
  // Render NYATA desain golden supaya laporan visual yang diuji asli, bukan karangan.
  const r = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'render.mjs'), '--design', path.join(repoRoot, 'fixtures', 'golden', 'valid', '04-carousel-design.json'), '--out', outDir], { cwd: repoRoot, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`render golden gagal: ${r.stderr}`);
  base = {
    carousel: read('fixtures/golden/valid/03-carousel.json'),
    verification: read('fixtures/golden/valid/02-verification-result.json'),
    research: read('fixtures/golden/valid/01-research-output.json'),
    design: read('fixtures/golden/valid/04-carousel-design.json'),
    visualQa: JSON.parse(readFileSync(path.join(outDir, 'visual-qa.json'), 'utf8')),
  };
}, 120_000);

afterAll(() => {
  try { for (const f of readdirSync(outDir)) rmSync(path.join(outDir, f), { recursive: true, force: true }); } catch { /* bersih */ }
});

const qa = (mutate) => {
  const input = clone(base);
  mutate?.(input);
  return runQa(input);
};

describe('paket valid', () => {
  it('golden + render nyata: lulus seluruhnya, tanpa routing', () => {
    const r = qa();
    expect(r.passed).toBe(true);
    expect(r.routeTo).toEqual([]);
    expect(r.slides).toHaveLength(6);
    expect(r.slides.every((s) => s.passed)).toBe(true);
    expect(r.summary).toMatchObject({ slides: 6, passedSlides: 6 });
  });
});

describe('gagal teks -> copywriter', () => {
  it('angka karangan di slide 2 menggagalkan hanya slide 2 dan diarahkan ke copywriter', () => {
    const r = qa((i) => { i.carousel.slides[1].body = 'Sebanyak 87 persen perusahaan sudah memakainya.'; i.carousel.slides[1].emphasis = []; });
    expect(r.passed).toBe(false);
    expect(r.routeTo).toContain('copywriter');
    expect(r.slides.filter((s) => !s.passed).map((s) => s.index)).toContain(2);
    expect(r.slides[1].text.join()).toMatch(/angka "87"/);
    expect(r.slides[0].text).toEqual([]);
  });
  it('sumber dari kandidat rejected: galat global (bukan per slide) ke copywriter', () => {
    const r = qa((i) => { i.carousel.sources[0] = { candidateId: 'c06', url: i.verification.results[5].url, source_name: 'AP' }; });
    expect(r.routeTo).toContain('copywriter');
    expect(r.global.text.join()).toMatch(/c06 tidak berstatus verified/);
  });
});

describe('gagal desain/visual -> designer', () => {
  it('Designer menambah angka baru: gagal desain di slide itu, diarahkan ke designer saja', () => {
    const r = qa((i) => { i.design.slides[1].slots.body = 'Sebanyak 87 persen perusahaan tidak boleh memakai AI menilai emosi pekerja.'; });
    expect(r.passed).toBe(false);
    expect(r.routeTo).toEqual(['designer']);
    expect(r.slides[1].design.join()).toMatch(/angka "87"/);
  });
  it('cek visual gagal (kontras) dilaporkan per slide dan diarahkan ke designer', () => {
    const r = qa((i) => { i.visualQa.slides[2].checks.contrast = { ok: false, measured: 2.1 }; i.visualQa.slides[2].passed = false; i.visualQa.passed = false; });
    expect(r.routeTo).toEqual(['designer']);
    expect(r.slides[2].visual.join()).toMatch(/contrast \(2\.1\)/);
    expect(r.slides[2].passed).toBe(false);
    expect(r.slides[0].passed).toBe(true);
  });
  it('jumlah PNG kurang dari jumlah slide ditolak', () => {
    const r = qa((i) => { i.visualQa.pngCount = 5; });
    expect(r.global.visual.join()).toMatch(/jumlah PNG \(5\)/);
    expect(r.passed).toBe(false);
  });
  it('laporan visual rusak (bukan dari renderer) ditolak', () => {
    const r = qa((i) => { delete i.visualQa.slides[0].checks.contrast; });
    expect(r.passed).toBe(false);
    expect(r.global.visual.join()).toMatch(/laporan visual tidak valid/);
  });
});

describe('gagal ganda', () => {
  it('teks dan visual sama-sama gagal -> keduanya di routing', () => {
    const r = qa((i) => {
      i.carousel.slides[1].heading = 'H'.repeat(75);
      i.visualQa.slides[0].checks.noOverflow = { ok: false };
      i.visualQa.slides[0].passed = false;
    });
    expect(r.routeTo.sort()).toEqual(['copywriter', 'designer']);
  });
});
