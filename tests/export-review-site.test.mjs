import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exportSite, publicMeta, renderIndex, dirNameOf } from '../scripts/export-review-site.mjs';
import mw from '../middleware.js';

function fixture() {
  const src = mkdtempSync(path.join(tmpdir(), 'aao-src-'));
  const run = path.join(src, 'EDU-9');
  mkdirSync(path.join(run, 'render'), { recursive: true });
  mkdirSync(path.join(run, 'assets'), { recursive: true });
  writeFileSync(path.join(run, 'carousel.json'), JSON.stringify({ topic: 'Uji <b>XSS</b>', angle: 'a', caption: 'cap & "q"', hashtags: ['#ai'], sources: [{ title: 'S1', url: 'https://contoh.com/a' }, { title: 'jahat', url: 'javascript:alert(1)' }], slides: [{ heading: 'x' }], secretPath: 'D:\\AI-Memory\\x' }));
  writeFileSync(path.join(run, 'render', 'slide-01.png'), 'png');
  writeFileSync(path.join(run, 'render', 'hashes.json'), '{}');
  writeFileSync(path.join(run, 'qa-result.json'), 'internal');
  return src;
}

describe('ekspor situs review', () => {
  it('hanya mengekspor yang disebut, hanya slide PNG + meta aman, tanpa berkas internal/jalur lokal', () => {
    const src = fixture(); const out = mkdtempSync(path.join(tmpdir(), 'aao-out-'));
    const items = exportSite({ runs: ['EDU-9'], srcRoot: src, outDir: out });
    expect(items).toHaveLength(1);
    expect(readdirSync(path.join(out, 'data', 'EDU-9')).sort()).toEqual(['meta.json', 'slide-01.png']);
    const all = readFileSync(path.join(out, 'index.html'), 'utf8') + readFileSync(path.join(out, 'data', 'EDU-9', 'meta.json'), 'utf8');
    expect(all).not.toMatch(/D:\\|AI-Memory|secretPath|javascript:|qa-result/);
    const html = readFileSync(path.join(out, 'index.html'), 'utf8'); expect(html).not.toContain('<b>XSS</b>'); expect(html).toContain('&lt;b&gt;XSS&lt;/b&gt;');
    expect(items[0].sources).toEqual([{ title: 'S1', url: 'https://contoh.com/a' }]);
  });
  it('menolak tanpa --runs, kode tidak valid, atau run tanpa render', () => {
    const src = fixture(); const out = mkdtempSync(path.join(tmpdir(), 'aao-out-'));
    expect(() => exportSite({ runs: [], srcRoot: src, outDir: out })).toThrow(/Sebutkan/);
    expect(() => exportSite({ runs: ['../x'], srcRoot: src, outDir: out })).toThrow(/tidak valid/);
    expect(() => exportSite({ runs: ['EDU-404'], srcRoot: src, outDir: out })).toThrow(/tidak ada/);
  });
  it('kode revisi dipetakan ke nama folder aman; halaman kosong tetap valid', () => {
    expect(dirNameOf('EDU-49/revision-2')).toBe('EDU-49_revision-2');
    expect(renderIndex([])).toMatch(/Belum ada konten/);
    expect(renderIndex([])).toMatch(/noindex/);
  });
});

describe('middleware Vercel (kata sandi review)', () => {
  const req = (auth) => ({ headers: { get: (k) => (k === 'authorization' ? auth ?? null : null) } });
  const b = (s) => 'Basic ' + Buffer.from(s).toString('base64');
  it('gagal-tertutup bila REVIEW_PASSWORD tidak diatur', () => {
    delete process.env.REVIEW_PASSWORD;
    expect(mw(req(b('klien:apa'))).status).toBe(503);
  });
  it('menerima kredensial benar, menolak salah/kosong/rusak', () => {
    process.env.REVIEW_PASSWORD = 'rahasia-panjang'; delete process.env.REVIEW_USER;
    expect(mw(req(b('klien:rahasia-panjang')))).toBeUndefined();
    expect(mw(req(b('klien:salah'))).status).toBe(401);
    expect(mw(req(b('lain:rahasia-panjang'))).status).toBe(401);
    expect(mw(req()).status).toBe(401);
    expect(mw(req('Basic ###')).status).toBe(401);
    expect(mw(req(b('klien:rahasia-panjang'))) === undefined).toBe(true);
    expect(mw(req()).headers.get('www-authenticate')).toMatch(/Basic/);
  });
});
