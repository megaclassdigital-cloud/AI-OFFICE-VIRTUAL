// Test validasi desain di scripts/render.mjs (AC1.6, skenario PRD "Teks meluber", "Template/aset hilang").
//
// Semua kasus di sini gagal di tahap validasi SEBELUM Chromium dinyalakan, jadi cepat dan murah.
// Yang dibuktikan: desain cacat ditolak dengan exit 2, pesan menyebut penyebabnya, dan TIDAK ada PNG.

import { describe, it, expect } from 'vitest';
import { runNode, makeTmp, writeJson, countPng, repoRoot } from './helpers.mjs';
import path from 'node:path';

const render = path.join(repoRoot, 'scripts', 'render.mjs');

/** Desain minimal valid pada tingkat struktur; tiap kasus merusak satu hal. */
function design(slides) {
  return {
    createdAt: '2026-10-08T00:00:00.000Z',
    brand: 'edukasiai',
    canvas: { width: 1080, height: 1350 },
    slides,
  };
}

const goodCover = {
  index: 1,
  template: 'cover',
  slots: { kicker: 'Berita AI', hook: 'Hook yang pendek dan jelas.' },
};

async function renderBad(slides) {
  const dir = makeTmp('aao-render-bad-');
  const designPath = writeJson(dir, 'design.json', design(slides));
  const out = path.join(dir, 'out');
  const r = await runNode([render, '--design', designPath, '--out', out]);
  return { ...r, pngs: countPng(out) };
}

describe('render.mjs menolak desain cacat sebelum merender', () => {
  const cases = [
    {
      name: 'teks melebihi batas karakter slot (tidak dipotong diam-diam)',
      slides: [{ ...goodCover, slots: { ...goodCover.slots, hook: 'x'.repeat(127) } }],
      expectMsg: /slot "hook" 127 karakter, melebihi batas 90/,
      expectNoCut: /TIDAK dipotong/,
    },
    {
      name: 'slot yang tidak dikenal template',
      slides: [{ ...goodCover, slots: { ...goodCover.slots, slotAsing: 'x' } }],
      expectMsg: /slot "slotAsing" tidak dikenal untuk template "cover"/,
    },
    {
      name: 'template yang tidak ada di templates.json',
      slides: [{ index: 1, template: 'templateHantu', slots: { heading: 'x' } }],
      expectMsg: /template "templateHantu" tidak ada/,
    },
    {
      name: 'slot wajib kosong',
      slides: [{ index: 1, template: 'cover', slots: { kicker: 'Berita AI' } }],
      expectMsg: /slot wajib "hook" kosong/,
    },
    {
      name: 'kata tekanan tidak ada di slot mana pun',
      slides: [{ ...goodCover, emphasis: ['tidakAda'] }],
      expectMsg: /kata tekanan "tidakAda" tidak ada di slot mana pun/,
    },
    {
      name: 'varian warna yang tidak ada di brand.json',
      slides: [{ ...goodCover, colorVariant: 'pelangi' }],
      expectMsg: /varian warna "pelangi" tidak ada/,
    },
    {
      name: 'ikon yang tidak ada di set lokal',
      slides: [{ ...goodCover, icon: 'ikon-hantu' }],
      expectMsg: /ikon "ikon-hantu" tidak ada/,
    },
  ];

  for (const c of cases) {
    it(`${c.name} -> exit 2, 0 PNG`, async () => {
      const r = await renderBad(c.slides);
      expect(r.code).toBe(2);
      expect(r.stderr).toMatch(/Validasi desain GAGAL/);
      expect(r.stderr).toMatch(c.expectMsg);
      if (c.expectNoCut) expect(r.stderr).toMatch(c.expectNoCut);
      expect(r.pngs).toBe(0);
    });
  }

  it('melaporkan SEMUA kesalahan sekaligus, bukan hanya yang pertama', async () => {
    const r = await renderBad([
      { ...goodCover, slots: { ...goodCover.slots, hook: 'x'.repeat(127), slotAsing: 'x' } },
      { index: 2, template: 'templateHantu', slots: { heading: 'x' } },
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/melebihi batas 90/);
    expect(r.stderr).toMatch(/slotAsing/);
    expect(r.stderr).toMatch(/templateHantu/);
    expect(r.pngs).toBe(0);
  });
});

describe('render.mjs argumen dan berkas', () => {
  it('tanpa --design: exit 1 dengan petunjuk pemakaian', async () => {
    const r = await runNode([render]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/Pemakaian/);
  });

  it('berkas design yang tidak ada: exit 1', async () => {
    const r = await runNode([render, '--design', path.join(makeTmp(), 'tidak-ada.json')]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/design tidak ditemukan/);
  });
});
