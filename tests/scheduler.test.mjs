import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeTmp } from './helpers.mjs';
import { DEFAULT_SETTINGS, mergeSettings, parseWindow, jitterMinutes, candidateSlots, freshUntilMs, assignSlots, briefsNeeded, replan, enqueueContent, newestSourceMs } from '../scripts/scheduler.mjs';

const H = 3_600_000; const MIN = 60_000;
const S = mergeSettings({});
// 16 Okt 2026 05:00 WIB = 15 Okt 22:00 UTC
const NOW = Date.UTC(2026, 9, 15, 22, 0);
const localMinutes = (ms) => { const d = new Date(ms + S.utcOffsetMinutes * MIN); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const inWindow = (ms, wins) => wins.map(parseWindow).some((w) => localMinutes(ms) >= w.startMin && localMinutes(ms) <= w.endMin);

describe('dasar jadwal', () => {
  it('parseWindow dan jitter deterministik', () => {
    expect(parseWindow('07:00-09:00')).toEqual({ startMin: 420, endMin: 540 });
    expect(parseWindow('9:00-8:00')).toBeNull(); expect(parseWindow('x')).toBeNull();
    expect(jitterMinutes('a|1|0', 30)).toBe(jitterMinutes('a|1|0', 30));
    expect(jitterMinutes('a|1|0', 0)).toBe(0);
    for (const s of ['p|1|0', 'p|2|1', 'q|9|2']) expect(jitterMinutes(s, 30)).toBeLessThanOrEqual(30);
  });
  it('mergeSettings memakai bawaan dan menimpa per platform', () => {
    const m = mergeSettings({ freshHours: 24, platforms: { tiktok: { maxPerDay: 1 } } });
    expect(m.freshHours).toBe(24); expect(m.platforms.tiktok.maxPerDay).toBe(1); expect(m.platforms.tiktok.windows).toEqual(DEFAULT_SETTINGS.platforms.tiktok.windows); expect(m.platforms.instagram.maxPerDay).toBe(2);
  });
  it('semua slot kandidat jatuh di dalam jendela owner dan terurut', () => {
    const slots = candidateSlots(S, 'instagram', NOW, NOW + 3 * 24 * H);
    expect(slots.length).toBe(9);
    expect(slots.every((t) => inWindow(t, S.platforms.instagram.windows))).toBe(true);
    expect([...slots].sort((a, b) => a - b)).toEqual(slots);
  });
  it('platform nonaktif atau tidak dikenal tidak punya slot', () => {
    expect(candidateSlots(mergeSettings({ platforms: { tiktok: { enabled: false } } }), 'tiktok', NOW, NOW + 48 * H)).toEqual([]);
    expect(candidateSlots(S, 'youtube', NOW, NOW + 48 * H)).toEqual([]);
  });
});

describe('assignSlots', () => {
  it('menghormati jeda minimum dan batas per hari', () => {
    const items = ['EDU-1', 'EDU-2', 'EDU-3', 'EDU-4'].map((c, i) => ({ content: c, freshUntil: NOW + (48 + i) * H }));
    const r = assignSlots(items, S, 'instagram', NOW).filter((x) => x.slotAt);
    expect(r.length).toBe(4);
    const times = r.map((x) => x.slotAt).sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(S.minGapMinutes * MIN);
    const perDay = {}; for (const t of times) { const d = Math.floor((t + S.utcOffsetMinutes * MIN) / (24 * H)); perDay[d] = (perDay[d] ?? 0) + 1; }
    expect(Math.max(...Object.values(perDay))).toBeLessThanOrEqual(2);
  });
  it('deadline terdekat dapat slot paling awal', () => {
    const r = assignSlots([{ content: 'LAMBAT', freshUntil: NOW + 60 * H }, { content: 'MENDESAK', freshUntil: NOW + 10 * H }], S, 'instagram', NOW);
    const a = r.find((x) => x.content === 'MENDESAK').slotAt; const b = r.find((x) => x.content === 'LAMBAT').slotAt;
    expect(a).toBeLessThan(b);
    expect(a).toBeLessThanOrEqual(NOW + 10 * H);
  });
  it('tanpa slot sebelum freshUntil, atau sudah lewat => kedaluwarsa', () => {
    const r = assignSlots([{ content: 'LEWAT', freshUntil: NOW - H }, { content: 'SEMPIT', freshUntil: NOW + 30 * MIN }], S, 'instagram', NOW);
    expect(r.find((x) => x.content === 'LEWAT').status).toBe('kedaluwarsa');
    expect(r.find((x) => x.content === 'SEMPIT').status).toBe('kedaluwarsa'); // jendela terdekat masih jauh
  });
  it('slot yang sudah sah dipertahankan (stabil) dan konten bersatus akhir tidak dijadwalkan ulang', () => {
    const first = assignSlots([{ content: 'A', freshUntil: NOW + 48 * H }], S, 'instagram', NOW);
    const again = assignSlots([{ content: 'A', freshUntil: NOW + 48 * H, slotAt: first[0].slotAt }, { content: 'B', freshUntil: NOW + 5 * H }], S, 'instagram', NOW);
    expect(again.find((x) => x.content === 'A').slotAt).toBe(first[0].slotAt);
    const done = assignSlots([{ content: 'C', freshUntil: NOW + 48 * H, status: 'diposting' }, { content: 'D', freshUntil: NOW + 48 * H, status: 'tidak_pasti' }], S, 'instagram', NOW);
    expect(done).toEqual([]);
  });
});

describe('briefsNeeded (sinyal penarikan untuk Manager)', () => {
  it('sama dengan slot kosong dalam horizon dikurangi yang sedang diproduksi; nol bila dijeda', () => {
    const empty = briefsNeeded({ settings: S, queue: [], inProduction: 0, nowMs: NOW });
    expect(empty).toBeGreaterThan(0);
    expect(briefsNeeded({ settings: S, queue: [], inProduction: 1, nowMs: NOW })).toBe(empty - 1);
    expect(briefsNeeded({ settings: S, queue: [], inProduction: 99, nowMs: NOW })).toBe(0);
    expect(briefsNeeded({ settings: mergeSettings({ paused: true }), queue: [], inProduction: 0, nowMs: NOW })).toBe(0);
  });
  it('slot yang sudah dipakai antrean mengurangi kebutuhan', () => {
    const queue = replan([{ content: 'EDU-1', freshUntil: NOW + 40 * H, platforms: { instagram: { status: 'menunggu', slotAt: null }, tiktok: { status: 'menunggu', slotAt: null } } }], S, NOW);
    expect(briefsNeeded({ settings: S, queue, inProduction: 0, nowMs: NOW })).toBe(briefsNeeded({ settings: S, queue: [], inProduction: 0, nowMs: NOW }) - 1);
  });
});

describe('enqueueContent', () => {
  it('memakai tanggal sumber TERBARU yang terverifikasi untuk freshUntil dan idempoten', () => {
    const out = makeTmp();
    const dir = path.join(out, 'runs', 'EDU-7');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'research-output.json'), JSON.stringify({ candidates: [{ id: 'c01', published_at: '2026-10-12' }, { id: 'c02', published_at: '2026-10-14' }, { id: 'c03', published_at: '2026-10-15' }] }));
    writeFileSync(path.join(dir, 'verification-result.json'), JSON.stringify({ results: [{ candidateId: 'c01', status: 'verified' }, { candidateId: 'c02', status: 'verified' }, { candidateId: 'c03', status: 'rejected' }] }));
    expect(new Date(newestSourceMs(out, 'EDU-7')).toISOString().slice(0, 10)).toBe('2026-10-14');
    const r = enqueueContent(out, 'EDU-7', NOW, S);
    expect(r.added).toBe(true);
    expect(r.queue[0].freshUntil).toBe(freshUntilMs(Date.parse('2026-10-14') + 24 * H - 1, S.freshHours));
    expect(Object.keys(r.queue[0].platforms).sort()).toEqual(['instagram', 'tiktok']);
    expect(() => enqueueContent(out, 'bukan-kode', NOW, S)).toThrow();
  });
});
