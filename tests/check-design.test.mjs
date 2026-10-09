// Test cek "fakta tidak berubah" untuk Designer (F1.7, AC1.7).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { checkDesign, properNamesIn } from '../scripts/check-design.mjs';
import { repoRoot } from './helpers.mjs';

const read = (rel) => JSON.parse(readFileSync(path.join(repoRoot, rel), 'utf8'));
const carousel = read('fixtures/golden/valid/03-carousel.json');
const golden = read('fixtures/golden/valid/04-carousel-design.json');
const clone = (o) => JSON.parse(JSON.stringify(o));
const run = (mutate) => {
  const d = clone(golden);
  mutate(d);
  return checkDesign(d, carousel);
};
const expectFail = (r, re) => {
  expect(r.ok).toBe(false);
  expect(r.errors.join(' | ')).toMatch(re);
};

describe('desain valid', () => {
  it('desain golden lolos (singkatan AP, nomor urut 01/02, kicker dekoratif diizinkan)', () => {
    expect(checkDesign(golden, carousel)).toEqual({ ok: true, errors: [] });
  });
  it('memendekkan teks tanpa mengubah fakta tetap lolos', () => {
    expect(run((d) => { d.slides[1].slots.body = 'Perusahaan tidak boleh memakai AI untuk menilai emosi pekerja lewat data biometrik.'; }).ok).toBe(true);
  });
});

describe('AC1.7: Designer tidak boleh menambah atau mengubah fakta', () => {
  it('menambah angka baru ditolak', () => {
    expectFail(run((d) => { d.slides[1].slots.body = 'Sebanyak 87 persen perusahaan tidak boleh memakai AI menilai emosi pekerja.'; }), /angka "87" di slot body/);
  });
  it('menambah persentase ditolak', () => {
    expectFail(run((d) => { d.slides[4].slots.heading = 'Berlaku 100% di California'; }), /angka "100"/);
  });
  it('mengubah tanggal ditolak', () => {
    expectFail(run((d) => { d.slides[2].slots.value = '1 Okt'; }), /angka "1" di slot value/);
  });
  it('menambah nama diri baru ditolak', () => {
    expectFail(run((d) => { d.slides[1].slots.body = 'Perusahaan seperti OpenAI tidak boleh memakai AI untuk menilai emosi pekerja.'; }), /nama "OpenAI"/);
  });
  it('mengganti nama sumber ditolak', () => {
    expectFail(run((d) => { d.slides[5].slots.sources = 'Sumber: Reuters'; }), /nama "Reuters"/);
  });
  it('angka baru di slot kicker tetap ditolak (hanya nama yang dikecualikan)', () => {
    expectFail(run((d) => { d.slides[0].slots.kicker = 'Berita AI 2026'; }), /angka "2026" di slot kicker/);
  });
});

describe('struktur desain', () => {
  it('template tidak sesuai peran slide ditolak', () => {
    expectFail(run((d) => { d.slides[1].template = 'quote'; d.slides[1].slots = { quote: 'Kutipan', attribution: 'AP' }; }), /template "quote" tidak sesuai peran point/);
  });
  it('jumlah slide berbeda ditolak', () => {
    expectFail(run((d) => { d.slides.pop(); }), /skema|jumlah slide/);
    const ten = checkDesign({ ...clone(golden), slides: [...clone(golden.slides), { ...clone(golden.slides[1]), index: 7 }] }, carousel);
    expectFail(ten, /jumlah slide desain \(7\)/);
  });
  it('index tidak sama dengan carousel ditolak', () => {
    expectFail(run((d) => { d.slides[2].index = 9; }), /index tidak sama/);
  });
  it('HTML bebas ditolak oleh skema', () => {
    expectFail(run((d) => { d.slides[0].html = '<b>x</b>'; }), /skema.*html/);
  });
  it('carousel rusak membuat pemeriksaan gagal, bukan lolos', () => {
    const bad = clone(carousel);
    bad.slides.pop();
    expect(checkDesign(golden, bad).ok).toBe(false);
  });
});

describe('properNamesIn', () => {
  it('kata pertama kalimat tidak dihitung nama; nama tengah dan akronim dihitung', () => {
    expect(properNamesIn('Gubernur Gavin Newsom menandatangani paket')).toEqual(['Gavin', 'Newsom']);
    expect(properNamesIn('Ikuti EdukasiAI sekarang')).toEqual(['EdukasiAI']);
    expect(properNamesIn('risiko AI. Berikutnya')).toEqual(['AI']);
  });
});

describe('instruksi Designer', () => {
  const md = readFileSync(path.join(repoRoot, 'divisions', 'edukasiai', 'agents', 'designer.md'), 'utf8');
  it('mewajibkan tool plugin, render_carousel, dan melarang HTTP sendiri', () => {
    for (const k of ['attach_file', 'complete_stage', 'render_carousel', 'Dilarang membuat panggilan HTTP sendiri']) expect(md).toContain(k);
  });
});

describe('format foto/ikon v3', () => {
  const hero = (image) => run((d) => { d.slides[0].template = 'hero-cover'; d.slides[0].slots = { image, kicker: 'Berita AI', headline: 'California batasi AI menilai pekerja lewat biometrik.', subtitle: 'Aturan baru juga mewajibkan pemberitahuan tertulis sebelum PHK massal.', source: 'Sumber: Associated Press' }; });
  it('peran hook boleh hero-cover; template di luar peran ditolak', () => {
    expect(hero('runs/EDU-9/assets/logo.png').errors.join(' | ')).not.toMatch(/tidak sesuai peran/);
    expectFail(run((d) => { d.slides[0].template = 'stat'; }), /tidak sesuai peran hook/);
  });
  it('slot gambar harus runs/EDU-n/assets/<berkas> atau brand/<berkas>', () => {
    expectFail(hero('../../etc/passwd.png'), /harus berupa runs/);
    expectFail(hero('https://x.com/a.png'), /harus berupa runs/);
    expect(hero('runs/EDU-9/assets/logo.png').errors.join(' | ')).not.toMatch(/harus berupa runs/);
    expect(hero('brand/hero-1.png').errors.join(' | ')).not.toMatch(/harus berupa runs/);
  });
  it('slot source harus memuat nama media dari daftar sumber carousel', () => {
    expect(hero('runs/EDU-9/assets/logo.png').errors.join(' | ')).not.toMatch(/slot source/);
    const r = run((d) => { d.slides[0].template = 'hero-cover'; d.slides[0].slots = { image: 'runs/EDU-9/assets/logo.png', kicker: 'Berita AI', headline: 'California batasi AI menilai pekerja lewat biometrik.', subtitle: 'x', source: 'Sumber: Media Karangan' }; });
    expectFail(r, /slot source/);
  });
});
