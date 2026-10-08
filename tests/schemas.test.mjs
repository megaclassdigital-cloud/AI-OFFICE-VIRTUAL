// Test validator skema bersama (schemas/validate.mjs) — F1.0b.
//
// Setiap skema di schemas/ wajib punya: satu contoh valid dan minimal DUA kasus invalid yang
// ditolak dengan alasan yang benar. Test pelindung di bawah menggagalkan build bila ada skema baru
// tanpa kasus uji, jadi aturan "minimal 2 kasus invalid per skema" tidak bisa dilupakan.

import { describe, it, expect } from 'vitest';
import { validate, assertValid, SchemaError, SCHEMA_NAMES } from '../schemas/validate.mjs';

const clone = (o) => JSON.parse(JSON.stringify(o));
const sha = (c) => c.repeat(64);

const candidate = (n) => ({
  id: `c${String(n).padStart(2, '0')}`,
  title: `Judul berita AI nomor ${n} dari sumber`,
  summary: 'Ringkasan berbahasa Indonesia yang netral dan cukup panjang untuk lolos batas minimal empat puluh karakter.',
  url: `https://example.com/berita-${n}`,
  published_at: '2026-10-07',
  source_name: 'Associated Press',
});

const slide = (i, role = 'point') => ({ index: i, role, heading: `Judul slide ${i}`, body: 'Isi slide yang singkat.' });
const designSlide = (i) => ({ index: i, template: 'point', slots: { heading: `Judul ${i}`, body: 'Isi.' } });
const okCheck = { ok: true };

/** Contoh VALID per skema. */
const valid = {
  'research-output': {
    generatedAt: '2026-10-08T01:00:00Z',
    windowDays: 7,
    candidates: [1, 2, 3, 4, 5].map(candidate),
  },
  'verification-result': {
    verifiedAt: '2026-10-08T01:05:00Z',
    windowDays: 7,
    results: [
      {
        candidateId: 'c01',
        url: 'https://example.com/berita-1',
        status: 'verified',
        checks: { urlReachable: { ok: true, httpStatus: 200 }, dateWithinWindow: { ok: true, ageDays: 1 } },
      },
    ],
  },
  carousel: {
    createdAt: '2026-10-08T01:10:00Z',
    topic: 'California batasi AI menilai pekerja',
    angle: 'Relevan untuk pekerja Indonesia yang bekerja untuk perusahaan global.',
    slides: [slide(1, 'hook'), slide(2), slide(3), slide(4), slide(5), slide(6, 'cta')],
    caption: 'California membatasi penggunaan AI untuk menilai emosi pekerja. Apa artinya buat kita? Simak slide berikut.',
    hashtags: ['#AI', '#Teknologi', '#EdukasiAI'],
    sources: [{ candidateId: 'c01', url: 'https://example.com/berita-1', source_name: 'Associated Press' }],
  },
  'carousel-design': {
    createdAt: '2026-10-08T01:15:00Z',
    brand: 'edukasiai',
    canvas: { width: 1080, height: 1350 },
    slides: [1, 2, 3, 4, 5, 6].map(designSlide),
  },
  'visual-qa': {
    renderedAt: '2026-10-08T01:20:00Z',
    renderer: { engine: 'playwright-chromium', version: '1.56.0' },
    canvas: { width: 1080, height: 1350 },
    slideCount: 1,
    pngCount: 1,
    passed: true,
    slides: [
      {
        index: 1,
        file: 'slide-01.png',
        passed: true,
        checks: { dimensions: okCheck, noOverflow: okCheck, minFontSize: okCheck, contrast: okCheck, slotLimits: okCheck },
      },
    ],
  },
  'approval-record': {
    schema_version: 1,
    record_id: '0b0e7c38-6a35-4a9e-9d6e-3f5b2b1f4c11',
    issue_id: '67395162-13fc-4811-aea6-5085c34b59b6',
    issue_identifier: 'EDU-12',
    decision: 'approved',
    decided_at: '2026-10-08T02:00:00Z',
    decided_by: 'owner',
    content_hash: {
      algorithm: 'sha256',
      combined: sha('a'),
      text: sha('b'),
      files: [{ path: 'slide-01.png', sha256: sha('c') }],
    },
  },
};

/** Kasus INVALID per skema: [nama, fungsi pengubah, potongan pesan/kata kunci yang harus muncul]. */
const invalid = {
  'research-output': [
    ['hanya 4 kandidat (minimal 5)', (d) => d.candidates.pop(), /fewer than 5 items|minItems/],
    ['URL bukan https', (d) => (d.candidates[0].url = 'http://example.com/x'), /pattern/],
    ['properti tidak dikenal di kandidat', (d) => (d.candidates[0].html = '<b>x</b>'), /tidak dikenal "html"/],
    ['id kandidat tidak sesuai pola', (d) => (d.candidates[0].id = 'kandidat-1'), /pattern/],
  ],
  'verification-result': [
    ['rejected tanpa alasan', (d) => Object.assign(d.results[0], { status: 'rejected' }), /required property 'reason'|reason/],
    ['rejected dengan alasan hanya spasi', (d) => Object.assign(d.results[0], { status: 'rejected', reason: '   ' }), /pattern/],
    ['status di luar enum', (d) => (d.results[0].status = 'mungkin'), /allowed values|enum/],
    ['cek urlReachable hilang', (d) => delete d.results[0].checks.urlReachable, /urlReachable/],
  ],
  carousel: [
    ['hanya 5 slide (minimal 6)', (d) => d.slides.pop(), /fewer than 6 items|minItems/],
    ['11 slide (maksimal 10)', (d) => { for (let i = 7; i <= 11; i++) d.slides.push(slide(i)); }, /more than 10 items|maxItems/],
    ['hashtag tanpa #', (d) => (d.hashtags[0] = 'AI'), /pattern/],
    ['sumber tanpa url', (d) => delete d.sources[0].url, /required property 'url'|url/],
    ['peran slide di luar enum', (d) => (d.slides[0].role = 'banner'), /allowed values|enum/],
  ],
  'carousel-design': [
    ['kanvas bukan 1080x1350', (d) => (d.canvas.height = 1080), /must be equal to constant|const/],
    ['template di luar enum (Designer tidak boleh mengarang)', (d) => (d.slides[0].template = 'hero'), /allowed values|enum/],
    ['properti HTML bebas ditolak', (d) => (d.slides[0].html = '<div>bebas</div>'), /tidak dikenal "html"/],
    ['slot kosong', (d) => (d.slides[0].slots = {}), /fewer than 1 items|minProperties|NOT have fewer/],
  ],
  'visual-qa': [
    ['cek contrast hilang', (d) => delete d.slides[0].checks.contrast, /contrast/],
    ['passed bukan boolean', (d) => (d.passed = 'ya'), /must be boolean/],
    ['properti tidak dikenal di cek', (d) => (d.slides[0].checks.noOverflow.rahasia = 1), /tidak dikenal "rahasia"/],
  ],
  'approval-record': [
    ['diputuskan oleh agent (bukan owner)', (d) => (d.decided_by = 'agent'), /must be equal to constant|const/],
    ['rejected tanpa catatan', (d) => (d.decision = 'rejected'), /required property 'note'|note/],
    ['rejected dengan catatan hanya spasi', (d) => { d.decision = 'rejected'; d.note = '   '; }, /pattern/],
    ['hash bukan 64 heksadesimal', (d) => (d.content_hash.combined = 'abc123'), /pattern/],
    ['daftar file hash kosong', (d) => (d.content_hash.files = []), /fewer than 1 items|minItems/],
    ['schema_version bukan 1', (d) => (d.schema_version = 2), /must be equal to constant|const/],
    ['issue_identifier tidak sesuai pola', (d) => (d.issue_identifier = 'edu12'), /pattern/],
  ],
};

describe('pelindung cakupan', () => {
  it('setiap skema di schemas/ punya contoh valid dan minimal 2 kasus invalid', () => {
    for (const name of SCHEMA_NAMES) {
      expect(valid[name], `skema "${name}" belum punya contoh valid di tests/schemas.test.mjs`).toBeDefined();
      expect(invalid[name]?.length ?? 0, `skema "${name}" butuh minimal 2 kasus invalid`).toBeGreaterThanOrEqual(2);
    }
  });

  it('daftar skema yang diharapkan tidak berkurang', () => {
    expect(SCHEMA_NAMES).toEqual(
      expect.arrayContaining(['approval-record', 'carousel', 'carousel-design', 'research-output', 'verification-result', 'visual-qa'])
    );
  });
});

for (const name of SCHEMA_NAMES) {
  describe(`skema ${name}`, () => {
    it('contoh valid diterima', () => {
      const r = validate(name, clone(valid[name]));
      expect(r.errors).toEqual([]);
      expect(r.ok).toBe(true);
    });

    for (const [label, mutate, expected] of invalid[name] ?? []) {
      it(`menolak: ${label}`, () => {
        const data = clone(valid[name]);
        mutate(data);
        const r = validate(name, data);
        expect(r.ok).toBe(false);
        expect(r.errors.length).toBeGreaterThan(0);
        const text = r.errors.map((e) => `${e.keyword} ${e.path} ${e.message}`).join(' | ');
        expect(text).toMatch(expected);
      });
    }
  });
}

describe('API validator', () => {
  it('assertValid melempar SchemaError berisi jalur kesalahan', () => {
    const bad = clone(valid.carousel);
    bad.slides.pop();
    let err;
    try {
      assertValid('carousel', bad);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SchemaError);
    expect(err.schemaName).toBe('carousel');
    expect(err.errors[0].path).toBe('/slides');
    expect(err.message).toMatch(/carousel/);
  });

  it('assertValid mengembalikan data yang sama bila valid', () => {
    const d = clone(valid['approval-record']);
    expect(assertValid('approval-record', d)).toBe(d);
  });

  it('nama skema tidak dikenal melempar galat yang menyebut daftar skema', () => {
    expect(() => validate('tidak-ada', {})).toThrow(/Skema tidak dikenal.*approval-record/);
  });

  it('melaporkan banyak kesalahan sekaligus (allErrors)', () => {
    const bad = clone(valid['approval-record']);
    bad.decided_by = 'agent';
    bad.content_hash.combined = 'x';
    bad.issue_identifier = 'salah';
    const r = validate('approval-record', bad);
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });
});
