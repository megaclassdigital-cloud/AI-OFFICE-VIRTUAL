import { describe, it, expect } from 'vitest';
import { decideAutoBrief, buildAutoBrief, parseTikTokContent, analyzeInsights, parseCount, isAutoBrief, AUTO_MARKER, autoOutcomes, inQuietHours, DEFAULTS } from '../scripts/autonomy-core.mjs';
import { parseRevisionBrief } from '../scripts/orchestrator-core.mjs';

const HOUR = 3_600_000;
// 2026-10-17 10:00 WIB = 03:00Z
const NOW = Date.parse('2026-10-17T03:00:00Z');
const idle = { job: false, followers: 0, pending: 0, inbox: 0 };
const ctx = (over = {}) => ({ settings: {}, nowMs: NOW, paused: false, offline: false, idle, awaitingOwner: 0, briefLog: [], recentAutoOutcomes: [], breakerUntilMs: null, ...over });

describe('keputusan brief otomatis (pagar)', () => {
  it('menganggur + antrean owner tipis + tidak ada log => bertindak', () => {
    expect(decideAutoBrief(ctx())).toMatchObject({ act: true, code: 'aktif' });
  });
  it('tidak bertindak bila: dimatikan, dijeda, offline, atau ada pekerjaan (job/follower/pending/inbox)', () => {
    expect(decideAutoBrief(ctx({ settings: { enabled: false } })).code).toBe('nonaktif');
    expect(decideAutoBrief(ctx({ paused: true })).code).toBe('dijeda');
    expect(decideAutoBrief(ctx({ offline: true })).code).toBe('offline');
    for (const i of [{ ...idle, job: true }, { ...idle, followers: 1 }, { ...idle, pending: 1 }, { ...idle, inbox: 1 }]) expect(decideAutoBrief(ctx({ idle: i })).code).toBe('sibuk');
  });
  it('antrean approval owner penuh => menahan (jangan menumpuk)', () => {
    expect(decideAutoBrief(ctx({ awaitingOwner: 2 })).code).toBe('antrean-owner');
    expect(decideAutoBrief(ctx({ awaitingOwner: 1 })).act).toBe(true);
  });
  it('batas harian dan jeda minimum', () => {
    const at = (h) => ({ atMs: NOW - h * HOUR });
    expect(decideAutoBrief(ctx({ briefLog: [at(1), at(3), at(5)] })).code).toBe('batas-harian'); // tiga brief hari ini (WIB)
    const r = decideAutoBrief(ctx({ briefLog: [at(1)] }));
    expect([r.act, r.code]).toEqual([false, 'jeda']);
    expect(r.retryAtMs).toBe(NOW - HOUR + 2 * HOUR);
    expect(decideAutoBrief(ctx({ briefLog: [at(2.5)] })).act).toBe(true);
  });
  it('brief kemarin tidak dihitung batas harian hari ini (hari lokal WIB)', () => {
    expect(decideAutoBrief(ctx({ briefLog: [{ atMs: NOW - 20 * HOUR }, { atMs: NOW - 21 * HOUR }, { atMs: NOW - 22 * HOUR }] })).act).toBe(true);
  });
  it('jam tenang WIB 00:00-05:00', () => {
    const night = Date.parse('2026-10-16T19:00:00Z'); // 02:00 WIB
    expect(inQuietHours({ ...DEFAULTS }, night)).toBe(true);
    expect(decideAutoBrief(ctx({ nowMs: night })).code).toBe('jam-tenang');
    expect(inQuietHours({ ...DEFAULTS }, NOW)).toBe(false);
  });
  it('pemutus: dua job otomatis terblokir berturut-turut => berhenti; sukses di antaranya mereset', () => {
    const r = decideAutoBrief(ctx({ recentAutoOutcomes: ['ok', 'blocked', 'blocked'] }));
    expect([r.act, r.code, r.trip]).toEqual([false, 'pemutus', true]);
    expect(r.retryAtMs).toBe(NOW + 6 * HOUR);
    expect(decideAutoBrief(ctx({ recentAutoOutcomes: ['blocked', 'ok', 'blocked'] })).act).toBe(true);
    expect(decideAutoBrief(ctx({ breakerUntilMs: NOW + HOUR })).code).toBe('pemutus');
    expect(decideAutoBrief(ctx({ breakerUntilMs: NOW - 1 })).act).toBe(true);
  });
  it('autoOutcomes: hanya job bertanda otomatis dan sesudah sinceMs', () => {
    const h = [{ brief: AUTO_MARKER + 'x', phase: 'blocked', endedMs: 5 }, { brief: 'owner', phase: 'blocked', endedMs: 6 }, { brief: AUTO_MARKER, phase: 'done', endedMs: 9 }];
    expect(autoOutcomes(h)).toEqual(['blocked', 'ok']);
    expect(autoOutcomes(h, 5)).toEqual(['ok']);
  });
});

const SAMPLE = `Posts 3 | Drafts 0
Posts (Created on)
Privacy
Views
Likes
Comments
Actions
Rangkuman AI terbaru dari Meta dan Microsoft! #EdukasiAI #MetaAI
Oct 17, 10:36 AM
Everyone
36
4
0
Anthropic memperkuat keamanan AI. Menurut lo, siapkah kita? #Anthropic #KeamananAI
Oct 15, 9:46 AM
Everyone
1.2K
39
2
Content under review
Debat open-weight AI makin panas, OpenAI ikut bicara
Sep 3, 9:35 PM
Only me
417
7
0`;

describe('analitik akun', () => {
  it('parseCount: angka dan singkatan K/M', () => {
    expect([parseCount('36'), parseCount('1.2K'), parseCount('2,500'), parseCount('3M'), parseCount('x')]).toEqual([36, 1200, 2500, 3000000, null]);
  });
  it('parseTikTokContent: judul, tanggal, privasi, angka; baris derau (Content under review) dilewati', () => {
    const p = parseTikTokContent(SAMPLE);
    expect(p).toHaveLength(3);
    expect(p[0]).toMatchObject({ title: 'Rangkuman AI terbaru dari Meta dan Microsoft! #EdukasiAI #MetaAI', views: 36, likes: 4, comments: 0, privacy: 'Everyone' });
    expect(p[1]).toMatchObject({ views: 1200, likes: 39, comments: 2 });
    expect(p[2]).toMatchObject({ title: 'Debat open-weight AI makin panas, OpenAI ikut bicara', privacy: 'Only me' });
  });
  it('teks kosong atau tidak dikenal => tidak ada posting (tidak dikarang)', () => {
    expect(parseTikTokContent('')).toEqual([]);
    expect(parseTikTokContent('Posts 0\nActions\nNo posts yet')).toEqual([]);
  });
  it('analyzeInsights: ringkasan dihitung dari data, hashtag merek tidak jadi topik, data sedikit diberi catatan', () => {
    const a = analyzeInsights(parseTikTokContent(SAMPLE));
    expect(a.n).toBe(3);
    expect(a.avgViews).toBe(Math.round((36 + 1200 + 417) / 3));
    expect(a.best[0].views).toBe(1200);
    const terms = a.topTerms.map((t) => t.term);
    expect(terms).toContain('#Anthropic');
    expect(terms).not.toContain('#EdukasiAI');
    expect(a.notes.join(' ')).toMatch(/Data masih sedikit/);
    expect(a.recentTitles).toHaveLength(3);
  });
  it('tanpa data => catatan jujur, tidak ada angka karangan', () => {
    const a = analyzeInsights([]);
    expect([a.n, a.notes]).toEqual([0, ['Belum ada data posting di akun.']]);
  });
});

describe('brief otomatis', () => {
  const analysis = analyzeInsights(parseTikTokContent(SAMPLE));
  it('bertanda otomatis, memuat profil audiens, batas kesegaran, dan daftar jangan-diulang', () => {
    const b = buildAutoBrief({ nowMs: NOW, insights: analysis, insightsAtMs: NOW - HOUR, recentTitles: ['Topik lama A', 'Topik lama B'], freshHours: 48 });
    expect(isAutoBrief(b)).toBe(true);
    expect(b).toMatch(/2026-10-17 10:00 WIB/);
    expect(b).toMatch(/tidak lebih tua dari 48 jam/); // batas seleksi internal, disebut sebagai bukan bahan tulisan
    expect(b).toMatch(/Rata-rata \d+ views/);
    expect(b).toMatch(/- Topik lama A/);
    expect(b).toMatch(/Jangan mengarang angka/);
  });
  it('tanpa analitik: jujur bahwa data belum ada, tidak mengarang profil', () => {
    const b = buildAutoBrief({ nowMs: NOW, insights: null, recentTitles: [] });
    expect(b).toMatch(/belum tersedia/);
    expect(b).not.toMatch(/Rata-rata/);
    expect(b).not.toMatch(/Jangan mengulang topik ini/);
  });
  it('bukan brief revisi (tidak salah dikenali parser revisi orkestrator)', () => {
    expect(parseRevisionBrief(buildAutoBrief({ nowMs: NOW }))).toBeNull();
  });
});

describe('brief otomatis: pembawaan topik tidak kaku terhadap info waktu', () => {
  const analysis = analyzeInsights(parseTikTokContent(SAMPLE));
  const b = buildAutoBrief({ nowMs: NOW, insights: analysis, insightsAtMs: NOW - HOUR, recentTitles: ['Topik lama A'], freshHours: 48 });
  const heading = b.split('\n').find((l) => l.startsWith('# '));
  it('judul brief (yang disalin Manager jadi judul kerja) bebas kata waktu', () => {
    expect(heading).not.toMatch(/terbaru|terkini|terhangat|48 jam|minggu ini|hari ini/i);
    expect(b).toMatch(/JANGAN memakai kata waktu/);
  });
  it('meminta SATU cerita spesifik, bukan rangkuman/daftar tren; jendela waktu hanya batas seleksi internal', () => {
    expect(b).toMatch(/SATU carousel/); expect(b).toMatch(/satu cerita AI yang spesifik/);
    expect(b).toMatch(/Bukan rangkuman umum/);
    expect(b).toMatch(/batas SELEKSI internal, bukan bahan tulisan/);
    expect(b).toMatch(/jangan menyebut jendela waktu itu di judul, hook, atau isi/);
  });
  it('melarang frasa kaku dan menyertakan contoh pembawaan (kalimat pembuka posting terbaik akun, tanpa hashtag)', () => {
    expect(b).toMatch(/Hindari frasa kaku/);
    expect(b).toMatch(/Contoh pembawaan yang sudah terbukti/);
    expect(b).toMatch(/"Anthropic memperkuat keamanan AI"/);
    expect(b).not.toMatch(/#Anthropic/);
  });
  it('tanpa data analitik: tidak ada bagian contoh pembawaan (tidak mengarang)', () => {
    expect(buildAutoBrief({ nowMs: NOW, insights: null })).not.toMatch(/Contoh pembawaan/);
  });
});
