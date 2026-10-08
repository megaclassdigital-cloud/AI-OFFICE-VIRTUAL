// Test cek deterministik draf Copywriter (F1.5): fixture valid dan invalid.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { checkCarousel } from '../scripts/check-carousel.mjs';
import { repoRoot } from './helpers.mjs';

const read = (rel) => JSON.parse(readFileSync(path.join(repoRoot, rel), 'utf8'));
const verification = read('fixtures/golden/valid/02-verification-result.json'); // c01-c05 verified, c06 rejected
const research = read('fixtures/golden/valid/01-research-output.json');
const golden = read('fixtures/golden/valid/03-carousel.json');
const clone = (o) => JSON.parse(JSON.stringify(o));
const run = (mutate, opts = { research }) => {
  const d = clone(golden);
  mutate(d);
  return checkCarousel(d, verification, opts);
};
const expectFail = (r, re) => {
  expect(r.ok).toBe(false);
  expect(r.errors.join(' | ')).toMatch(re);
};

describe('draf valid', () => {
  it('carousel golden lolos semua cek (dengan dan tanpa riset)', () => {
    expect(checkCarousel(golden, verification, { research })).toEqual({ ok: true, errors: [] });
    expect(checkCarousel(golden, verification).ok).toBe(true);
  });
  it('10 slide (batas atas) lolos', () => {
    const r = run((d) => {
      for (let i = 7; i <= 10; i++) d.slides.splice(d.slides.length - 1, 0, { index: 0, role: 'point', heading: 'Poin tambahan', body: 'Isi singkat.', sourceRefs: ['c04'] });
      d.slides.forEach((s, i) => (s.index = i + 1));
    });
    expect(r.errors).toEqual([]);
  });
});

describe('sumber', () => {
  it('sumber dari kandidat rejected ditolak', () => {
    expectFail(run((d) => { d.sources[0] = { candidateId: 'c06', url: verification.results[5].url, source_name: 'AP' }; d.slides.forEach((s) => s.sourceRefs && (s.sourceRefs = ['c06'])); }), /c06 tidak berstatus verified/);
  });
  it('sumber karangan (kandidat tidak ada) ditolak', () => {
    expectFail(run((d) => { d.sources.push({ candidateId: 'c09', url: 'https://example.com/baru', source_name: 'Baru' }); }), /c09 tidak berstatus verified/);
  });
  it('URL sumber tidak sama persis dengan hasil Verifier ditolak', () => {
    expectFail(run((d) => { d.sources[0].url = d.sources[0].url + '?ref=x'; }), /berbeda dari hasil Verifier/);
  });
  it('sumber ganda ditolak', () => {
    expectFail(run((d) => { d.sources.push({ ...d.sources[0] }); }), /terdaftar dua kali/);
  });
});

describe('klaim dan sourceRefs', () => {
  it('slide faktual tanpa sourceRefs ditolak; cta boleh tanpa', () => {
    expectFail(run((d) => { delete d.slides[1].sourceRefs; }), /slide 2 \(point\): klaim tanpa sourceRefs/);
    expect(run((d) => { delete d.slides[5].sourceRefs; }).ok).toBe(true);
  });
  it('sourceRefs ke kandidat tak terverifikasi atau tak terdaftar ditolak', () => {
    expectFail(run((d) => { d.slides[1].sourceRefs = ['c06']; }), /slide 2: sourceRefs c06 tidak berstatus verified/);
    expectFail(run((d) => { d.slides[1].sourceRefs = ['c01']; }), /slide 2: sourceRefs c01 tidak ada di daftar sources/);
  });
  it('angka yang tidak ada di sumber ditolak (klaim karangan)', () => {
    expectFail(run((d) => { d.slides[1].body = 'Sebanyak 87 persen perusahaan sudah memakainya.'; }), /angka "87" tidak ditemukan/);
  });
  it('angka dicek hanya bila riset diberikan', () => {
    expect(run((d) => { d.slides[1].body = 'Sebanyak 87 persen perusahaan sudah memakainya.'; d.slides[1].emphasis = []; }, {}).ok).toBe(true);
  });
});

describe('panjang teks dan struktur', () => {
  it('heading melebihi slot template ditolak', () => {
    expectFail(run((d) => { d.slides[1].heading = 'H'.repeat(75); }), /slide 2: heading 75 karakter melebihi batas 70/);
  });
  it('body melebihi slot template ditolak walau lolos batas skema', () => {
    expectFail(run((d) => { d.slides[5].body = 'B'.repeat(200); }), /slide 6: body 200 karakter melebihi batas 180/);
  });
  it('5 slide ditolak oleh skema', () => {
    expectFail(run((d) => { d.slides.pop(); }), /skema: \/slides/);
  });
  it('index tidak berurutan ditolak', () => {
    expectFail(run((d) => { d.slides[2].index = 7; }), /urutan index harus 3/);
  });
  it('kata tekanan yang tidak ada di teks ditolak', () => {
    expectFail(run((d) => { d.slides[1].emphasis = ['robot']; }), /kata tekanan "robot" tidak ada/);
  });
});

describe('instruksi Copywriter', () => {
  const md = readFileSync(path.join(repoRoot, 'divisions', 'edukasiai', 'agents', 'copywriter.md'), 'utf8');
  it('mewajibkan tool plugin, sourceRefs, dan melarang HTTP sendiri', () => {
    for (const k of ['attach_file', 'complete_stage', 'sourceRefs', 'Dilarang membuat panggilan HTTP sendiri']) expect(md).toContain(k);
  });
});
