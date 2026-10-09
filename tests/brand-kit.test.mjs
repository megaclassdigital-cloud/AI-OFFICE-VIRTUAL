// Test brand kit (F1.6a): font lokal berlisensi, ikon berlisensi, design system v2 owner.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { repoRoot } from './helpers.mjs';

const brandDir = path.join(repoRoot, 'divisions', 'edukasiai', 'brand');
const brand = JSON.parse(readFileSync(path.join(brandDir, 'brand.json'), 'utf8').replace(/^﻿/, ''));

describe('font', () => {
  it('lima bobot Poppins ada, berformat woff2 sungguhan, dan lisensi OFL menyertainya', () => {
    for (const f of ['Poppins-Regular', 'Poppins-Medium', 'Poppins-SemiBold', 'Poppins-Bold', 'Poppins-ExtraBold']) {
      const buf = readFileSync(path.join(brandDir, 'fonts', f + '.woff2'));
      expect(buf.subarray(0, 4).toString('latin1'), f).toBe('wOF2');
      expect(buf.length).toBeGreaterThan(5_000);
    }
    const ofl = readFileSync(path.join(brandDir, 'fonts', 'OFL-Poppins.txt'), 'utf8');
    expect(ofl).toMatch(/SIL Open Font License/);
  });
  it('brand.json menunjuk Poppins dan setiap berkas di fontFiles benar-benar ada', () => {
    expect(brand.typography.localFontDir).toBe('fonts');
    expect(brand.typography.fontFamily).toBe('Poppins');
    expect(brand.typography.fontFamilyStack).toMatch(/^'Poppins'/);
    for (const [, file] of brand.typography.fontFiles) expect(statSync(path.join(brandDir, 'fonts', file)).isFile()).toBe(true);
  });
});

describe('design system v2 (owner)', () => {
  const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  it('varian produksi gelap: editorial (bawaan), risiko, teknologi; label kuning, teks putih, kontras >= ambang', () => {
    expect(brand.defaultVariant).toBe('editorial');
    for (const k of ['editorial', 'risiko', 'teknologi']) {
      const v = brand.variants[k];
      expect(v.kicker, k).toBe('#FFD21F');
      expect(v.text, k).toBe('#FFFFFF');
      expect(v.background, k).toContain('#050505');
      for (const c of [v.text, v.muted, v.accent]) expect(ratio(c, '#050505'), k + c).toBeGreaterThanOrEqual(brand.minContrastRatio);
    }
    expect(brand.variants.risiko.accent).toBe('#FF3B42');
    expect(brand.variants.teknologi.accent).toBe('#14D9F5');
  });
  it('tanpa nomor halaman, footer edukasiai.co.id, kanvas 1080x1350', () => {
    expect(brand.slideCounter).toBe(false);
    expect(brand.logo.text).toBe('edukasiai.co.id');
    expect(brand.canvas).toMatchObject({ width: 1080, height: 1350 });
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
  it('brand.json berstatus v2-owner-design-system (menggantikan brand kit sementara F1.6)', () => {
    expect(brand.status).toBe('v2-owner-design-system');
  });
});
