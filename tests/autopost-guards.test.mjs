import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeTmp } from './helpers.mjs';
import { mergeAutopostSettings, canPostLive, ledgerBlocks, postingsToday, assertClickAllowed, FINAL_ACTION_RE, cooldownStatus, formatRemaining, gapMinutes } from '../scripts/autopost/guards.mjs';
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
    expect(canPostLive({ settings: live(), platform: 'instagram', ledger: [recent(60)], content: 'EDU-9', approval: OK, nowMs: NOW }).reasons.join(' ')).toMatch(/jeda 3 jam antar posting belum terpenuhi \(sisa 2 jam/);
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

describe('jeda dihitung dari waktu posting terakhir (keputusan owner)', () => {
  const posted = (minAgo, platform = 'instagram') => ({ content: 'EDU-1', platform, mode: 'live', status: 'diposting', at: new Date(NOW - minAgo * 60_000).toISOString() });
  it('cooldownHours global jadi jeda; minGapMinutes per platform menimpa', () => {
    expect(gapMinutes({}, 'instagram')).toBe(180);
    expect(gapMinutes({ cooldownHours: 5 }, 'tiktok')).toBe(300);
    expect(gapMinutes({ cooldownHours: 5, platforms: { tiktok: { minGapMinutes: 90 } } }, 'tiktok')).toBe(90);
  });
  it('hitung mundur: sisa waktu, siap setelah jeda lewat, tanpa posting = siap', () => {
    const c = cooldownStatus([posted(60)], 'instagram', {}, NOW);
    expect(c.ready).toBe(false); expect(c.remainingMs).toBe(120 * 60_000); expect(c.nextAllowedAt).toBe(new Date(NOW + 120 * 60_000).toISOString());
    expect(cooldownStatus([posted(181)], 'instagram', {}, NOW).ready).toBe(true);
    expect(cooldownStatus([], 'instagram', {}, NOW)).toMatchObject({ ready: true, remainingMs: 0, lastPostAt: null });
    expect(cooldownStatus([posted(10, 'tiktok')], 'instagram', {}, NOW).ready).toBe(true); // platform lain tidak memengaruhi
  });
  it('dry-run tidak memulai jeda; hanya posting live', () => {
    expect(cooldownStatus([{ ...posted(10), mode: 'dry-run' }], 'instagram', {}, NOW).ready).toBe(true);
  });
  it('formatRemaining ramah dibaca', () => {
    expect(formatRemaining(0)).toBe('siap'); expect(formatRemaining(14 * 60_000)).toBe('14 menit'); expect(formatRemaining(134 * 60_000)).toBe('2 jam 14 menit'); expect(formatRemaining(120 * 60_000)).toBe('2 jam');
  });
});

describe('kegagalan sebelum terkirim: coba ulang berjeda dan berbatas', () => {
  const fail = (minAgo) => ({ content: 'EDU-1', platform: 'instagram', mode: 'live', status: 'gagal', at: new Date(NOW - minAgo * 60_000).toISOString() });
  it('menunggu jeda coba ulang; setelah jeda boleh lagi; setelah 3 kegagalan butuh pemeriksaan owner', () => {
    const r1 = canPostLive({ settings: live(), platform: 'instagram', ledger: [fail(10)], content: 'EDU-1', approval: OK, nowMs: NOW });
    expect(r1.ok).toBe(false); expect(r1.reasons.join(' ')).toMatch(/menunggu coba ulang setelah gagal \(sisa 20 menit/);
    expect(canPostLive({ settings: live(), platform: 'instagram', ledger: [fail(40)], content: 'EDU-1', approval: OK, nowMs: NOW }).ok).toBe(true);
    const r3 = canPostLive({ settings: live(), platform: 'instagram', ledger: [fail(400), fail(300), fail(200)], content: 'EDU-1', approval: OK, nowMs: NOW });
    expect(r3.ok).toBe(false); expect(r3.reasons.join(' ')).toMatch(/gagal 3x.*owner/);
  });
  it('kegagalan konten lain atau platform lain tidak memengaruhi', () => {
    expect(canPostLive({ settings: live(), platform: 'instagram', ledger: [{ ...fail(5), content: 'EDU-2' }], content: 'EDU-1', approval: OK, nowMs: NOW }).ok).toBe(true);
  });
});

import { deriveTitle } from '../scripts/autopost/package.mjs';
import { SENT_RE, SENT_URL_RE } from '../scripts/autopost/tiktok.mjs';
describe('TikTok: judul dan bukti terkirim', () => {
  it('deriveTitle: kalimat pertama, maksimal 90, dipotong di batas kata', () => {
    expect(deriveTitle('Rangkuman AI terbaru! Mulai dari Meta.', 90)).toBe('Rangkuman AI terbaru');
    expect(deriveTitle('satu\ndua', 90)).toBe('satu');
    const long = 'kata '.repeat(40).trim();
    const t = deriveTitle(long, 90); expect(t.length).toBeLessThanOrEqual(90); expect(t.endsWith('kata')).toBe(true);
    expect(deriveTitle('', 90)).toBe('');
  });
  it('"N photos uploaded" (sebelum Post) BUKAN bukti terkirim; "Manage your posts" dan halaman konten adalah bukti', () => {
    expect(SENT_RE.test('7 photos uploaded. Drag and drop to reorder')).toBe(false);
    expect(SENT_RE.test('Manage your posts')).toBe(true);
    expect(SENT_URL_RE.test('https://www.tiktok.com/tiktokstudio/content')).toBe(true);
    expect(SENT_URL_RE.test('https://www.tiktok.com/tiktokstudio/upload')).toBe(false);
  });
  it('"Post now" dan sejenisnya tergolong tombol final', () => {
    for (const l of ['Post now', 'Post anyway', 'Posting sekarang', 'Share now']) expect(() => assertClickAllowed(l, { dryRun: true })).toThrow(/DITOLAK/);
    expect(assertClickAllowed('Save draft', { dryRun: true })).toBe(true);
    expect(assertClickAllowed('Discard', { dryRun: true })).toBe(true);
  });
});
