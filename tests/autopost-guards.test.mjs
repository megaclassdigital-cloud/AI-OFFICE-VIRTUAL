import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeTmp } from './helpers.mjs';
import { mergeAutopostSettings, canPostLive, ledgerBlocks, postingsToday, assertClickAllowed, FINAL_ACTION_RE } from '../scripts/autopost/guards.mjs';
import { composeCaption, validatePackage, pngSize, buildPackage, LIMITS } from '../scripts/autopost/package.mjs';

const NOW = Date.UTC(2026, 9, 16, 5, 0); // 12:00 WIB
const OK = { approved: true, hashMatches: true };
const live = (extra = {}) => ({ platforms: { instagram: { live: true, maxPerDay: 2, minGapMinutes: 180 } }, ...extra });

describe('canPostLive (semua pagar harus lolos)', () => {
  it('lolos hanya bila live menyala, tidak dijeda, approved + hash cocok, tidak duplikat, batas harian dan jeda terpenuhi', () => {
    expect(canPostLive({ settings: live(), platform: 'instagram', ledger: [], content: 'EDU-97', approval: OK, nowMs: NOW })).toEqual({ ok: true, reasons: [] });
  });
  it('bawaan aman: live mati dan kill switch menolak', () => {
    expect(mergeAutopostSettings({}).platforms.instagram.live).toBe(false);
    const r = canPostLive({ settings: {}, platform: 'instagram', ledger: [], content: 'EDU-97', approval: OK, nowMs: NOW });
    expect(r.ok).toBe(false); expect(r.reasons.join(' ')).toMatch(/belum dinyalakan/);
    expect(canPostLive({ settings: live({ paused: true }), platform: 'instagram', ledger: [], content: 'EDU-97', approval: OK, nowMs: NOW }).reasons.join(' ')).toMatch(/kill switch/);
  });
  it('menolak tanpa approval atau bila isi berubah setelah approval', () => {
    expect(canPostLive({ settings: live(), platform: 'instagram', ledger: [], content: 'EDU-97', approval: { approved: false }, nowMs: NOW }).reasons.join(' ')).toMatch(/belum di-approve/);
    expect(canPostLive({ settings: live(), platform: 'instagram', ledger: [], content: 'EDU-97', approval: { approved: true, hashMatches: false }, nowMs: NOW }).reasons.join(' ')).toMatch(/hash tidak cocok/);
    expect(canPostLive({ settings: live(), platform: 'instagram', ledger: [], content: 'EDU-97', approval: null, nowMs: NOW }).ok).toBe(false);
  });
  it('ledger mencegah kirim ganda; status tidak_pasti memblokir; dry-run dan status gagal tidak memblokir', () => {
    const at = new Date(NOW - 10 * 3600_000).toISOString();
    for (const status of ['diposting', 'sedang_diposting', 'tidak_pasti']) {
      const r = canPostLive({ settings: live(), platform: 'instagram', ledger: [{ content: 'EDU-97', platform: 'instagram', mode: 'live', status, at }], content: 'EDU-97', approval: OK, nowMs: NOW });
      expect(r.ok).toBe(false); expect(r.reasons.join(' ')).toContain('tidak dikirim ulang');
    }
    expect(ledgerBlocks([{ content: 'EDU-97', platform: 'instagram', mode: 'dry-run', status: 'diposting', at }], 'EDU-97', 'instagram')).toBeNull();
    expect(ledgerBlocks([{ content: 'EDU-97', platform: 'instagram', mode: 'live', status: 'gagal', at }], 'EDU-97', 'instagram')).toBeNull();
    expect(ledgerBlocks([{ content: 'EDU-97', platform: 'tiktok', mode: 'live', status: 'diposting', at }], 'EDU-97', 'instagram')).toBeNull();
  });
  it('batas harian dan jeda minimum antar posting', () => {
    const recent = (min) => ({ content: 'EDU-1', platform: 'instagram', mode: 'live', status: 'diposting', at: new Date(NOW - min * 60_000).toISOString() });
    expect(canPostLive({ settings: live(), platform: 'instagram', ledger: [recent(60)], content: 'EDU-9', approval: OK, nowMs: NOW }).reasons.join(' ')).toMatch(/jeda minimum/);
    const two = [recent(300), { ...recent(200), content: 'EDU-2' }];
    expect(canPostLive({ settings: live(), platform: 'instagram', ledger: two, content: 'EDU-9', approval: OK, nowMs: NOW }).reasons.join(' ')).toMatch(/batas harian/);
    expect(postingsToday(two, 'instagram', NOW).count).toBe(2);
  });
  it('platform tidak dikenal ditolak', () => {
    expect(canPostLive({ settings: {}, platform: 'youtube', ledger: [], content: 'EDU-1', approval: OK, nowMs: NOW }).ok).toBe(false);
  });
});

describe('assertClickAllowed (dry-run tidak pernah menekan tombol kirim)', () => {
  it('menolak tombol final dalam dry-run, termasuk padanan bahasa Indonesia, dan tanpa izin eksplisit di live', () => {
    for (const l of ['Share', 'share', 'Bagikan', ' Post ', 'Posting', 'Publikasikan', 'Kirim', 'Unggah']) {
      expect(() => assertClickAllowed(l, { dryRun: true })).toThrow(/DITOLAK/);
      expect(() => assertClickAllowed(l, { dryRun: true, allowFinal: true })).toThrow(/DITOLAK/); // izin tidak berlaku di dry-run
      expect(() => assertClickAllowed(l, { dryRun: false })).toThrow(/DITOLAK/);
    }
    expect(assertClickAllowed('Share', { dryRun: false, allowFinal: true })).toBe(true);
  });
  it('tombol biasa diizinkan', () => {
    for (const l of ['Next', 'Berikutnya', 'Create', 'Buat', 'Select from computer', 'Pilih dari komputer', 'Discard', 'Buang', 'Share to Facebook']) expect(assertClickAllowed(l, { dryRun: true })).toBe(true);
    expect(FINAL_ACTION_RE.test('Postingan baru')).toBe(false);
  });
});

const png = (w, h) => { const b = Buffer.alloc(32); b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
describe('paket posting', () => {
  it('pngSize membaca header; bukan PNG => null', () => {
    expect(pngSize(png(1080, 1350))).toEqual({ w: 1080, h: 1350 }); expect(pngSize(Buffer.from('abc'))).toBeNull();
  });
  it('caption + hashtag disusun sekali; validasi jumlah slide, dimensi, panjang', () => {
    expect(composeCaption('Halo #A', ['#A', '#B'])).toBe('Halo #A\n\n#B');
    const sl = (n, w = 1080, h = 1350) => Array.from({ length: n }, (_, i) => ({ name: `slide-0${i + 1}.png`, size: { w, h } }));
    expect(validatePackage({ slides: sl(7), caption: 'x', hashtags: ['#a'] })).toEqual([]);
    expect(validatePackage({ slides: sl(1), caption: 'x', hashtags: [] }).join()).toMatch(/kurang dari/);
    expect(validatePackage({ slides: sl(11), caption: 'x', hashtags: [] }).join()).toMatch(/lebih dari/);
    expect(validatePackage({ slides: sl(7, 1000, 1000), caption: 'x', hashtags: [] }).join()).toMatch(/seharusnya 1080x1350/);
    expect(validatePackage({ slides: sl(7), caption: '', hashtags: [] }).join()).toMatch(/caption kosong/);
    expect(validatePackage({ slides: sl(7), caption: 'a'.repeat(LIMITS.maxCaption), hashtags: ['#x'] }).join()).toMatch(/2200/);
  });
  it('buildPackage membaca versi terbaru dari folder run', () => {
    const out = makeTmp();
    const base = path.join(out, 'runs', 'EDU-5');
    const rev = path.join(base, 'revision-1');
    mkdirSync(path.join(rev, 'render'), { recursive: true });
    for (let i = 1; i <= 3; i++) writeFileSync(path.join(rev, 'render', `slide-0${i}.png`), png(1080, 1350));
    writeFileSync(path.join(rev, 'carousel.json'), JSON.stringify({ caption: 'Berita AI hari ini', hashtags: ['#EdukasiAI'] }));
    const p = buildPackage(out, 'EDU-5');
    expect(p.runKey).toBe('EDU-5/revision-1'); expect(p.slides.length).toBe(3); expect(p.errors).toEqual([]); expect(p.captionFull).toBe('Berita AI hari ini\n\n#EdukasiAI');
  });
});
