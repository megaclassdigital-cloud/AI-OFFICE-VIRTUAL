#!/usr/bin/env node
// build-golden-fixtures.mjs — membuat fixtures/golden/ (F1.0c).
//
// Asal data:
//   - Riset  : keluaran NYATA Researcher dari F0.2 (docs/spike/evidence/F0.2-research-output.json),
//              dinormalisasi secara deterministik (id c01.., generatedAt, windowDays). Normalisasi ini
//              pekerjaan KODE, bukan LLM (F1.2 memakai logika yang sama).
//   - Verifikasi, carousel, design: SINTETIS tetapi koheren dan hanya memuat klaim yang ada di ringkasan
//              sumber (c04). Tidak ada kutipan karangan. Verifikasi bukan hasil pemeriksaan URL sungguhan.
//   - Kasus invalid: turunan dari kasus valid dengan SATU kerusakan yang disengaja.
//
// Pemakaian: node scripts/build-golden-fixtures.mjs   (menimpa fixtures/golden/)

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'fixtures', 'golden');
const clone = (o) => JSON.parse(JSON.stringify(o));

rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, 'valid'), { recursive: true });
mkdirSync(path.join(out, 'invalid'), { recursive: true });

const write = (rel, data) => writeFileSync(path.join(out, rel), JSON.stringify(data, null, 2) + '\n', 'utf8');

// ── 1. Riset (nyata, dinormalisasi) ─────────────────────────────────────────────
// Berkas bukti F0.2 berawalan BOM (ditulis PowerShell 5.1); buang sebelum parse.
const raw = JSON.parse(readFileSync(path.join(root, 'docs/spike/evidence/F0.2-research-output.json'), 'utf8').replace(/^﻿/, ''));
const GENERATED_AT = '2026-10-04T16:27:00Z'; // waktu run F0.2 yang sebenarnya
const research = {
  generatedAt: GENERATED_AT,
  windowDays: 7,
  candidates: raw.candidates.map((c, i) => ({
    id: `c${String(i + 1).padStart(2, '0')}`,
    title: c.title,
    summary: c.summary,
    url: c.url,
    published_at: c.published_at,
    source_name: c.source_name,
  })),
};
write('valid/01-research-output.json', research);

const byId = Object.fromEntries(research.candidates.map((c) => [c.id, c]));
const ageDays = (c) => Math.round((Date.parse(GENERATED_AT) - Date.parse(c.published_at)) / 86_400_000);

// ── 2. Verifikasi (sintetis): c01–c05 lolos, c06 ditolak (URL 404) ──────────────
const verified = ['c01', 'c02', 'c03', 'c04', 'c05'];
const verification = {
  verifiedAt: '2026-10-04T16:40:00Z',
  windowDays: 7,
  results: [
    ...verified.map((id) => ({
      candidateId: id,
      url: byId[id].url,
      status: 'verified',
      checks: {
        urlReachable: { ok: true, httpStatus: 200, finalUrl: byId[id].url },
        dateWithinWindow: { ok: true, publishedAt: byId[id].published_at, ageDays: ageDays(byId[id]) },
        claimFound: { ok: true, note: 'Klaim utama ringkasan ada di halaman (contoh sintetis).' },
      },
    })),
    {
      candidateId: 'c06',
      url: byId.c06.url,
      status: 'rejected',
      reason: 'URL mengembalikan HTTP 404 pada pemeriksaan (contoh sintetis untuk jalur penolakan).',
      checks: {
        urlReachable: { ok: false, httpStatus: 404, error: 'HTTP 404' },
        dateWithinWindow: { ok: true, publishedAt: byId.c06.published_at, ageDays: ageDays(byId.c06) },
      },
    },
  ],
};
write('valid/02-verification-result.json', verification);

// ── 3. Carousel (sintetis, hanya klaim dari ringkasan c04) ──────────────────────
const c04 = byId.c04;
const carousel = {
  createdAt: '2026-10-04T16:55:00Z',
  topic: 'California batasi AI menilai pekerja lewat data biometrik',
  angle:
    'Kebijakan nyata yang menyentuh dunia kerja sehari-hari; relevan bagi profesional Indonesia yang bekerja dengan perusahaan global.',
  slides: [
    {
      index: 1,
      role: 'hook',
      heading: 'California batasi AI menilai pekerja lewat biometrik.',
      body: 'Aturan baru juga mewajibkan pemberitahuan tertulis sebelum PHK massal.',
      emphasis: ['pekerja'],
      sourceRefs: ['c04'],
    },
    {
      index: 2,
      role: 'point',
      heading: 'Apa yang dilarang',
      body: 'Perusahaan tidak boleh memakai AI untuk menilai emosi pekerja lewat data biometrik, dan tidak boleh memakainya untuk menentukan pemecatan.',
      emphasis: ['emosi'],
      sourceRefs: ['c04'],
    },
    {
      index: 3,
      role: 'stat',
      heading: '30 Sep',
      body: 'Tanggal laporan Associated Press terbit. Gubernur Gavin Newsom menandatangani paket undang-undang perlindungan pekerja dari risiko AI.',
      sourceRefs: ['c04'],
    },
    {
      index: 4,
      role: 'comparison',
      heading: 'Dilarang dan diwajibkan',
      body: 'Dilarang: menilai emosi pekerja lewat data biometrik dan menentukan pemecatan dengan AI. Diwajibkan: pemberitahuan tertulis bila AI menjadi bagian keputusan PHK massal.',
      sourceRefs: ['c04'],
    },
    {
      index: 5,
      role: 'point',
      heading: 'Di mana berlakunya',
      body: 'Aturan ini adalah undang-undang negara bagian California. Pekerja di sana mendapat perlindungan baru dari penilaian otomatis.',
      sourceRefs: ['c04'],
    },
    {
      index: 6,
      role: 'cta',
      heading: 'Simpan kalau berguna.',
      body: 'Kami rangkum kebijakan AI yang berdampak ke dunia kerja setiap minggu.',
    },
  ],
  caption:
    'California membatasi penggunaan AI untuk menilai emosi pekerja lewat data biometrik, dan mewajibkan pemberitahuan tertulis sebelum PHK massal yang melibatkan AI. Simak ringkasannya di slide. Sumber: Associated Press.',
  hashtags: ['#AI', '#KecerdasanBuatan', '#DuniaKerja', '#Regulasi', '#EdukasiAI', '#AINews'],
  sources: [{ candidateId: 'c04', url: c04.url, source_name: c04.source_name }],
};
write('valid/03-carousel.json', carousel);

// ── 4. Design spec (sintetis, selaras dengan carousel) ──────────────────────────
const design = {
  createdAt: '2026-10-04T17:05:00Z',
  brand: 'edukasiai',
  canvas: { width: 1080, height: 1350 },
  slides: [
    {
      index: 1,
      template: 'cover',
      emphasis: ['pekerja'],
      slots: {
        kicker: 'Berita AI · Minggu ini',
        hook: 'California batasi AI menilai pekerja lewat biometrik.',
        subtitle: 'Aturan baru juga mewajibkan pemberitahuan tertulis sebelum PHK massal.',
      },
    },
    {
      index: 2,
      template: 'point',
      emphasis: ['emosi'],
      slots: {
        number: '01',
        heading: 'Apa yang dilarang',
        body: 'Perusahaan tidak boleh memakai AI untuk menilai emosi pekerja lewat data biometrik, dan tidak boleh memakainya untuk menentukan pemecatan.',
      },
    },
    {
      index: 3,
      template: 'stat',
      colorVariant: 'tegas',
      slots: {
        source: 'Associated Press',
        value: '30 Sep',
        label: 'Tanggal laporan AP terbit',
        context: 'Gubernur Gavin Newsom menandatangani paket undang-undang perlindungan pekerja dari risiko AI.',
      },
    },
    {
      index: 4,
      template: 'comparison',
      colorVariant: 'terang',
      slots: {
        heading: 'Dilarang dan diwajibkan',
        leftLabel: 'Dilarang',
        leftBody: 'Menilai emosi pekerja lewat data biometrik dan menentukan pemecatan dengan AI.',
        rightLabel: 'Diwajibkan',
        rightBody: 'Pemberitahuan tertulis bila AI menjadi bagian keputusan PHK massal.',
      },
    },
    {
      index: 5,
      template: 'point',
      slots: {
        number: '02',
        heading: 'Di mana berlakunya',
        body: 'Aturan ini adalah undang-undang negara bagian California. Pekerja di sana mendapat perlindungan baru dari penilaian otomatis.',
      },
    },
    {
      index: 6,
      template: 'cta',
      slots: {
        heading: 'Simpan kalau berguna.',
        body: 'Kami rangkum kebijakan AI yang berdampak ke dunia kerja setiap minggu.',
        action: 'Ikuti EdukasiAI',
        sources: 'Sumber: Associated Press',
      },
    },
  ],
};
write('valid/04-carousel-design.json', design);

// ── 5. Kasus INVALID: satu kerusakan per berkas ─────────────────────────────────
const manifest = [
  { file: 'valid/01-research-output.json', schema: 'research-output', expect: 'valid' },
  { file: 'valid/02-verification-result.json', schema: 'verification-result', expect: 'valid' },
  { file: 'valid/03-carousel.json', schema: 'carousel', expect: 'valid' },
  { file: 'valid/04-carousel-design.json', schema: 'carousel-design', expect: 'valid' },
];

function bad(file, schema, source, mutate, keyword, why) {
  const d = clone(source);
  mutate(d);
  write(`invalid/${file}`, d);
  manifest.push({ file: `invalid/${file}`, schema, expect: 'invalid', keyword, why });
}

bad('i01-research-4-candidates.json', 'research-output', research, (d) => d.candidates.splice(4), 'minItems',
  'hanya 4 kandidat (minimal 5); riset nyata punya 6 sehingga perlu membuang dua');
bad('i02-research-http-url.json', 'research-output', research, (d) => (d.candidates[2].url = 'http://apnews.com/x'), 'pattern',
  'URL sumber bukan https');
bad('i03-verification-rejected-without-reason.json', 'verification-result', verification,
  (d) => delete d.results[5].reason, 'required', 'kandidat rejected tanpa alasan');
bad('i04-carousel-5-slides.json', 'carousel', carousel, (d) => d.slides.pop(), 'minItems', 'hanya 5 slide (minimal 6)');
bad('i05-carousel-source-without-url.json', 'carousel', carousel, (d) => delete d.sources[0].url, 'required',
  'sumber tanpa URL');
bad('i06-design-free-html.json', 'carousel-design', design, (d) => (d.slides[0].html = '<div style="color:red">bebas</div>'),
  'additionalProperties', 'Designer menyelipkan HTML bebas (dilarang, ADR-0002)');
bad('i07-design-unknown-template.json', 'carousel-design', design, (d) => (d.slides[1].template = 'hero'), 'enum',
  'template di luar enum');
bad('i08-design-wrong-canvas.json', 'carousel-design', design, (d) => (d.canvas.height = 1080), 'const',
  'kanvas bukan 1080x1350');

write('manifest.json', manifest);
console.log(`fixtures/golden dibuat: ${manifest.filter((m) => m.expect === 'valid').length} valid, ${manifest.filter((m) => m.expect === 'invalid').length} invalid`);
