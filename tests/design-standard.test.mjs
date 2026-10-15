import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { checkStandard, familyOf, loadStandard } from '../scripts/design-standard.mjs';

const std = loadStandard();
const slide = (index, template, colorVariant, emphasis = []) => ({ index, template, colorVariant, emphasis, slots: {} });
const carousel = (roles) => ({ slides: roles.map((role, i) => ({ index: i + 1, role })) });
const roles6 = ['hook', 'point', 'point', 'point', 'point', 'cta'];
const good = () => ({ slides: [slide(1, 'hero-cover', 'editorial'), slide(2, 'point', 'editorial'), slide(3, 'comparison', 'editorial'), slide(4, 'point', 'editorial'), slide(5, 'point', 'editorial'), slide(6, 'hero-cta', 'editorial')] });

describe('patokan desain (satu acuan)', () => {
  it('berkas patokan dan gambar acuan ada dan konsisten dengan dirinya sendiri', () => {
    expect(existsSync(new URL('../' + std.referenceSheet, import.meta.url))).toBe(true);
    const ref = JSON.parse(readFileSync(new URL('../' + std.referenceDesign, import.meta.url), 'utf8'));
    const r = checkStandard(ref, carousel(roles6), std);
    expect(r.errors).toEqual([]); // desain acuan sendiri lolos patokan
  });
  it('desain seragam dan sekeluarga lolos', () => { expect(checkStandard(good(), carousel(roles6), std).ok).toBe(true); });
  it('campur varian warna di satu carousel ditolak; varian tak dikenal ditolak', () => {
    const d = good(); d.slides[2].colorVariant = 'risiko';
    expect(checkStandard(d, carousel(roles6), std).errors.join()).toMatch(/SAMA di semua slide/);
    const e = good(); e.slides.forEach((s) => { s.colorVariant = 'pelangi'; });
    expect(checkStandard(e, carousel(roles6), std).errors.join()).toMatch(/tidak ada di daftar patokan/);
  });
  it('slide tanpa colorVariant dianggap varian bawaan (editorial) dan boleh bercampur dengan editorial eksplisit', () => {
    const d = good(); delete d.slides[1].colorVariant;
    expect(checkStandard(d, carousel(roles6), std).ok).toBe(true);
  });
  it('pembuka hero + penutup biasa (tidak sekeluarga) ditolak; netral diterima', () => {
    const d = good(); d.slides[5].template = 'cta';
    expect(checkStandard(d, carousel(roles6), std).errors.join()).toMatch(/sekeluarga/);
    const n = good(); n.slides[5].template = 'stat'; // keluarga netral tidak dipaksa
    expect(checkStandard(n, carousel(roles6), std).errors.join()).not.toMatch(/sekeluarga/);
    expect(familyOf('hero-cta', std)).toBe('hero'); expect(familyOf('point', std)).toBe('plain'); expect(familyOf('flow', std)).toBe('neutral');
  });
  it('struktur: jumlah slide dan peran pertama/terakhir', () => {
    const few = { slides: good().slides.slice(0, 4) };
    expect(checkStandard(few, carousel(roles6.slice(0, 4)), std).errors.join()).toMatch(/minimal 6 slide/);
    expect(checkStandard(good(), carousel(['point', 'point', 'point', 'point', 'point', 'cta']), std).errors.join()).toMatch(/slide pertama harus berperan hook/);
    expect(checkStandard(good(), carousel(['hook', 'point', 'point', 'point', 'point', 'point']), std).errors.join()).toMatch(/slide terakhir harus berperan cta/);
  });
  it('lebih dari 2 kata penekanan per slide ditolak', () => {
    const d = good(); d.slides[1].emphasis = ['a', 'b', 'c'];
    expect(checkStandard(d, carousel(roles6), std).errors.join()).toMatch(/3 kata penekanan/);
  });
  it('desain kosong gagal, bukan lolos', () => { expect(checkStandard({ slides: [] }, null, std).ok).toBe(false); });
});
