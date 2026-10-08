// Test brand kit (F1.6a): font lokal berlisensi, ikon berlisensi, status tetap "sementara".
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { repoRoot } from './helpers.mjs';

const brandDir = path.join(repoRoot, 'divisions', 'edukasiai', 'brand');
const brand = JSON.parse(readFileSync(path.join(brandDir, 'brand.json'), 'utf8').replace(/^﻿/, ''));

describe('font', () => {
  it('empat bobot Inter ada, berformat woff2 sungguhan, dan lisensi OFL menyertainya', () => {
    for (const f of ['Inter-Regular', 'Inter-Medium', 'Inter-SemiBold', 'Inter-Bold']) {
      const buf = readFileSync(path.join(brandDir, 'fonts', `${f}.woff2`));
      expect(buf.subarray(0, 4).toString('latin1'), f).toBe('wOF2');
      expect(buf.length).toBeGreaterThan(50_000);
    }
    const ofl = readFileSync(path.join(brandDir, 'fonts', 'OFL.txt'), 'utf8');
    expect(ofl).toMatch(/SIL Open Font License, Version 1\.1/);
    expect(ofl).toMatch(/Inter Project Authors/);
  });
  it('brand.json menunjuk folder font lokal dan menamai Inter lebih dulu di stack', () => {
    expect(brand.typography.localFontDir).toBe('fonts');
    expect(brand.typography.fontFamilyStack).toMatch(/^'Inter'/);
  });
});

describe('ikon', () => {
  const dir = path.join(brandDir, 'icons');
  const svgs = readdirSync(dir).filter((f) => f.endsWith('.svg'));
  it('6-10 SVG dan berkas lisensi', () => {
    expect(svgs.length).toBeGreaterThanOrEqual(6);
    expect(svgs.length).toBeLessThanOrEqual(10);
    expect(statSync(path.join(dir, 'LICENSE.txt')).size).toBeGreaterThan(50);
    expect(readFileSync(path.join(dir, 'LICENSE.txt'), 'utf8')).toMatch(/CC0/);
  });
  it('setiap SVG berwarna currentColor, tanpa script, tanpa referensi eksternal', () => {
    for (const f of svgs) {
      const t = readFileSync(path.join(dir, f), 'utf8');
      expect(t, f).toMatch(/^<svg [^>]*viewBox="0 0 24 24"/);
      expect(t, f).toContain('currentColor');
      expect(t, f).not.toMatch(/<script|href=|url\(|on[a-z]+=/i);
    }
  });
});

describe('status', () => {
  it('brand.json tetap berstatus sementara sampai owner menyetujui', () => {
    expect(brand.status).toBe('sementara');
  });
});
