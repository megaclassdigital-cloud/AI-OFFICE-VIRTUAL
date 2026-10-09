import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildQuery, inboxPath, keywords, scoreResult, MIN_SCORE, captureOne, ENGINES, isBlankStats } from '../scripts/capture-asset.mjs';

describe('capture-asset', () => {
  it('buildQuery memperkuat merek dan produk', () => {
    expect(buildQuery({ kind: 'brand', query: 'Anthropic Claude' })).toBe('Anthropic Claude logo official');
    expect(buildQuery({ kind: 'brand', query: 'OpenAI logo' })).toBe('OpenAI logo');
    expect(buildQuery({ kind: 'product', query: 'ChatGPT app' })).toBe('ChatGPT app official');
    expect(buildQuery({ kind: 'photo', query: ' robot ' })).toBe('robot');
  });

  it('inboxPath: berkas owner menang, ekstensi lain diterima', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cap-'));
    mkdirSync(path.join(dir, 'workspace', 'inbox', 'assets', 'EDU-1'), { recursive: true });
    expect(inboxPath('EDU-1', 'logo.png', dir)).toBeNull();
    writeFileSync(path.join(dir, 'workspace', 'inbox', 'assets', 'EDU-1', 'logo.jpg'), 'x');
    expect(inboxPath('EDU-1', 'logo.png', dir)).toMatch(/logo\.jpg$/);
  });

  it('keywords membuang kata umum dan duplikat', () => {
    expect(keywords('The Claude logo official claude AI')).toEqual(['claude']);
  });

  it('merek: wajib memuat nama merek DAN kata logo; berita biasa ditolak', () => {
    const req = { kind: 'brand', query: 'Anthropic Claude', brand: 'Claude' };
    const logo = { t: 'Claude logo official', murl: 'https://x/claude-logo.png', purl: 'https://x' };
    const news = { t: 'Claude 3 better than ChatGPT', murl: 'https://x/photo.jpg', purl: 'https://x' };
    const other = { t: 'Gemini logo', murl: 'https://x/gemini-logo.png', purl: 'https://x' };
    expect(scoreResult(req, logo)).toBeGreaterThanOrEqual(MIN_SCORE.brand);
    expect(scoreResult(req, news)).toBeLessThan(MIN_SCORE.brand);
    expect(scoreResult(req, other)).toBeLessThan(MIN_SCORE.brand);
  });

  it('foto: hasil tak relevan di bawah ambang', () => {
    const req = { kind: 'photo', query: 'AI agent workflow robot dashboard' };
    const bad = { t: 'lelang majalah台風クラブ', murl: 'https://a/b.jpg', purl: 'https://a' };
    const good = { t: 'AI agent workflow dashboard', murl: 'https://a/c.jpg', purl: 'https://a' };
    expect(scoreResult(req, bad)).toBeLessThan(MIN_SCORE.photo);
    expect(scoreResult(req, good)).toBeGreaterThanOrEqual(MIN_SCORE.photo);
  });

  it('captureOne: jatuh ke mesin berikutnya saat diblokir; semua diblokir => blocked, tanpa gambar pengganti', async () => {
    const orig = { ...ENGINES };
    ENGINES.google = async () => ({ status: 'blocked', reason: 'captcha' });
    ENGINES.bing = async () => ({ status: 'captured', imageUrl: 'u' });
    const state = { blocked: new Set() };
    const r = await captureOne(null, { kind: 'photo', query: 'robot arm' }, 'x.png', ['google', 'bing'], state);
    expect(r.status).toBe('captured'); expect(r.engine).toBe('bing'); expect(state.blocked.has('google')).toBe(true);
    ENGINES.bing = async () => ({ status: 'blocked', reason: 'v' });
    const st2 = { blocked: new Set() };
    const r2 = await captureOne(null, { kind: 'photo', query: 'robot arm' }, 'x.png', ['google', 'bing'], st2);
    expect(r2.status).toBe('blocked');
    ENGINES.bing = async () => ({ status: 'missing', reason: 'kosong' });
    const r3 = await captureOne(null, { kind: 'photo', query: 'robot arm' }, 'x.png', ['bing'], { blocked: new Set() });
    expect(r3.status).toBe('missing');
    Object.assign(ENGINES, orig);
  });
});

describe('gambar kosong dan status kept', () => {
  it('isBlankStats: persegi seragam atau sedikit warna ditolak, foto/logo wajar lolos', () => {
    expect(isBlankStats({ colors: 1, std: 0 })).toBe(true);
    expect(isBlankStats({ colors: 3, std: 40 })).toBe(true);
    expect(isBlankStats({ colors: 40, std: 2 })).toBe(true);
    expect(isBlankStats({ colors: 12, std: 60 })).toBe(false);
    expect(isBlankStats({ colors: 400, std: 55 })).toBe(false);
  });
});

import { hasCheckerboard, NOT_OFFICIAL_RE } from '../scripts/capture-asset.mjs';
describe('kotak-kotak transparansi dan hasil non-resmi', () => {
  const checker = (square, n, a = 255, b = 238) => Array.from({ length: square * n }, (_, i) => (Math.floor(i / square) % 2 === 0 ? a : b));
  it('mendeteksi pola kotak-kotak teratur beramplitudo kecil', () => {
    expect(hasCheckerboard([checker(10, 14)])).toBe(true);
    expect(hasCheckerboard([checker(8, 20, 240, 205)])).toBe(true);
    expect(hasCheckerboard([[1, 2, 3], checker(12, 12)])).toBe(true);
  });
  it('tidak menandai teks/logo (tepi tajam), latar rata, gradasi landai, atau foto acak', () => {
    expect(hasCheckerboard([checker(10, 14, 255, 0)])).toBe(false);
    expect(hasCheckerboard([Array(300).fill(240)])).toBe(false);
    expect(hasCheckerboard([Array.from({ length: 300 }, (_, i) => 100 + i * 0.3)])).toBe(false);
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    expect(hasCheckerboard([Array.from({ length: 300 }, () => 100 + rnd() * 80)])).toBe(false);
    expect(hasCheckerboard([])).toBe(false);
  });
  it('merek/produk: konsep, mockup, dan desain pihak ketiga ditolak; logo resmi tetap lolos', () => {
    const req = { kind: 'product', brand: 'ChatGPT', query: 'ChatGPT interface UI official' };
    expect(scoreResult(req, { t: 'ChatGPT Voice Interface Concept - UI Dux', murl: '', purl: '' })).toBe(0);
    expect(scoreResult(req, { t: 'ChatGPT interface mockup on Dribbble', murl: '', purl: '' })).toBe(0);
    expect(scoreResult(req, { t: 'ChatGPT interface UI official screenshot', murl: '', purl: '' })).toBeGreaterThan(0);
    expect(NOT_OFFICIAL_RE.test('The secret meaning behind the OpenAI logo')).toBe(false);
    expect(scoreResult({ kind: 'photo', query: 'robot concept' }, { t: 'robot concept art', murl: '', purl: '' })).toBeGreaterThan(0);
  });
});
