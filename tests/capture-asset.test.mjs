import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildQuery, inboxPath, keywords, scoreResult, MIN_SCORE, captureOne, ENGINES } from '../scripts/capture-asset.mjs';

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
