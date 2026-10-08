// Test golden fixtures (F1.0c): memvalidasi SEMUA berkas di fixtures/golden/ terhadap skema yang dideklarasikan,
// dan memastikan satu kasus lengkap yang valid itu koheren antar tahap (riset → verifikasi → carousel → desain).
//
// Fixture dibuat oleh scripts/build-golden-fixtures.mjs. Test ini membaca berkasnya, bukan generatornya,
// sehingga yang diuji adalah apa yang benar-benar ter-commit.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { validate } from '../schemas/validate.mjs';
import { repoRoot } from './helpers.mjs';

const dir = path.join(repoRoot, 'fixtures', 'golden');
const read = (rel) => JSON.parse(readFileSync(path.join(dir, rel), 'utf8'));
const manifest = read('manifest.json');

describe('manifest fixtures', () => {
  it('setiap berkas JSON di valid/ dan invalid/ terdaftar di manifest (tidak ada fixture yatim)', () => {
    const onDisk = ['valid', 'invalid'].flatMap((d) => readdirSync(path.join(dir, d)).map((f) => `${d}/${f}`)).sort();
    const listed = manifest.map((m) => m.file).sort();
    expect(listed).toEqual(onDisk);
  });

  it('ada minimal 5 kasus invalid dan satu kasus valid untuk tiap tahap', () => {
    expect(manifest.filter((m) => m.expect === 'invalid').length).toBeGreaterThanOrEqual(5);
    const validSchemas = manifest.filter((m) => m.expect === 'valid').map((m) => m.schema).sort();
    expect(validSchemas).toEqual(['carousel', 'carousel-design', 'research-output', 'verification-result']);
  });

  it('kasus invalid mencakup tiap tahap yang bisa gagal (riset, verifikasi, carousel, desain)', () => {
    const covered = new Set(manifest.filter((m) => m.expect === 'invalid').map((m) => m.schema));
    for (const s of ['research-output', 'verification-result', 'carousel', 'carousel-design']) {
      expect(covered.has(s), `belum ada fixture invalid untuk ${s}`).toBe(true);
    }
  });
});

describe('validasi setiap fixture terhadap skemanya', () => {
  for (const m of manifest) {
    it(`${m.file} -> ${m.expect === 'valid' ? 'diterima' : `ditolak (${m.why})`}`, () => {
      const r = validate(m.schema, read(m.file));
      if (m.expect === 'valid') {
        expect(r.errors).toEqual([]);
        expect(r.ok).toBe(true);
      } else {
        expect(r.ok).toBe(false);
        // ditolak karena ALASAN yang dimaksud, bukan karena kerusakan lain yang tidak sengaja
        expect(r.errors.map((e) => e.keyword)).toContain(m.keyword);
      }
    });
  }
});

describe('kasus golden: koherensi antar tahap', () => {
  const research = read('valid/01-research-output.json');
  const verification = read('valid/02-verification-result.json');
  const carousel = read('valid/03-carousel.json');
  const design = read('valid/04-carousel-design.json');

  const roleToTemplate = { hook: 'cover', point: 'point', stat: 'stat', quote: 'quote', comparison: 'comparison', cta: 'cta' };
  const verifiedIds = new Set(verification.results.filter((r) => r.status === 'verified').map((r) => r.candidateId));

  it('riset memakai keluaran nyata F0.2: 6 kandidat, id unik, semua https', () => {
    expect(research.candidates).toHaveLength(6);
    const ids = research.candidates.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(research.candidates.every((c) => c.url.startsWith('https://'))).toBe(true);
  });

  it('verifikasi hanya merujuk kandidat yang ada, dengan URL yang sama persis', () => {
    const byId = Object.fromEntries(research.candidates.map((c) => [c.id, c]));
    for (const r of verification.results) {
      expect(byId[r.candidateId], `kandidat ${r.candidateId} tidak ada di riset`).toBeDefined();
      expect(r.url).toBe(byId[r.candidateId].url);
    }
  });

  it('jalur penolakan tercakup: ada kandidat rejected dengan alasan', () => {
    const rejected = verification.results.filter((r) => r.status === 'rejected');
    expect(rejected.length).toBeGreaterThanOrEqual(1);
    expect(rejected.every((r) => r.reason && r.checks.urlReachable.ok === false)).toBe(true);
  });

  it('semua tanggal terbit masuk jendela 7 hari terhadap waktu riset', () => {
    for (const r of verification.results) {
      expect(r.checks.dateWithinWindow.ok).toBe(true);
      expect(r.checks.dateWithinWindow.ageDays).toBeLessThanOrEqual(verification.windowDays);
    }
  });

  it('carousel hanya memakai sumber yang berstatus verified (tidak ada sumber baru)', () => {
    for (const s of carousel.sources) expect(verifiedIds.has(s.candidateId), `${s.candidateId} tidak terverifikasi`).toBe(true);
    for (const sl of carousel.slides) for (const ref of sl.sourceRefs ?? []) expect(verifiedIds.has(ref)).toBe(true);
  });

  it('carousel: slide berurutan 1..N dan emphasis benar-benar ada di teks slide', () => {
    carousel.slides.forEach((s, i) => expect(s.index).toBe(i + 1));
    for (const s of carousel.slides) {
      for (const word of s.emphasis ?? []) expect(`${s.heading} ${s.body}`).toContain(word);
    }
  });

  it('desain selaras dengan carousel: jumlah slide sama dan template sesuai peran', () => {
    expect(design.slides).toHaveLength(carousel.slides.length);
    design.slides.forEach((d, i) => {
      expect(d.index).toBe(carousel.slides[i].index);
      expect(d.template).toBe(roleToTemplate[carousel.slides[i].role]);
    });
  });
});
