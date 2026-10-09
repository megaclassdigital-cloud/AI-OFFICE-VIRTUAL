import { describe, it, expect } from 'vitest';
import { probe, decide, isOffline, isNetworkError, OFFLINE_AFTER, ONLINE_AFTER } from '../scripts/netcheck.mjs';

describe('probe', () => {
  it('terjangkau bila minimal satu target menjawab (status apa pun)', async () => {
    const fetchFn = async (url) => { if (url.includes('gstatic')) throw new Error('boom'); return { status: 404 }; };
    expect((await probe({ fetchFn })).reachable).toBe(true);
  });
  it('tidak terjangkau bila semua gagal, dengan alasan tiap target', async () => {
    const fetchFn = async () => { const e = new Error('fetch failed'); e.cause = { code: 'ENOTFOUND' }; throw e; };
    const r = await probe({ fetchFn });
    expect(r.reachable).toBe(false); expect(r.results.every((x) => x.error === 'ENOTFOUND')).toBe(true);
  });
});

describe('decide (histeresis)', () => {
  it('menahan kerja sejak gagal pertama, mengumumkan offline setelah OFFLINE_AFTER kali', () => {
    let s = {}; let r = decide(s, false, 1000);
    expect(r.state.hold).toBe(true); expect(r.events).toEqual([]); s = r.state;
    r = decide(s, false, 2000);
    expect(r.events).toEqual([{ type: 'offline', since: 1000 }]); expect(OFFLINE_AFTER).toBe(2);
    r = decide(r.state, false, 3000); expect(r.events).toEqual([]); // tidak diumumkan dua kali
  });
  it('kedip satu probe tidak pernah diumumkan; pulih diumumkan setelah ONLINE_AFTER probe baik', () => {
    let r = decide({}, false, 1000); r = decide(r.state, true, 2000);
    expect(r.state.hold).toBe(true); // masih menahan sampai stabil
    r = decide(r.state, true, 3000);
    expect(r.state.hold).toBe(false); expect(r.events).toEqual([]); // tidak pernah diumumkan offline -> tidak ada notif online
    expect(ONLINE_AFTER).toBe(2);
  });
  it('outage yang sudah diumumkan -> notif online membawa lama putus', () => {
    let s = {}; for (const t of [1000, 2000, 3000]) s = decide(s, false, t).state;
    s = decide(s, true, 10_000).state; const r = decide(s, true, 11_000);
    expect(r.events).toEqual([{ type: 'online', downMs: 10_000 }]); expect(r.state).toMatchObject({ online: true, hold: false });
  });
});

describe('isOffline / isNetworkError', () => {
  it('berkas basi tidak menahan kerja selamanya', () => {
    const st = { hold: true, updatedAtMs: 1000 };
    expect(isOffline(st, 1000 + 60_000)).toBe(true);
    expect(isOffline(st, 1000 + 300_000)).toBe(false);
    expect(isOffline(null)).toBe(false); expect(isOffline({ hold: false, updatedAtMs: Date.now() })).toBe(false);
  });
  it('mengenali galat jaringan, bukan galat kuota/tugas', () => {
    for (const t of ['Cannot connect to API: Unable to connect. Is the computer able to access the url?', 'Cannot connect to API: Was there a typo in the url or port?', 'fetch failed', 'getaddrinfo ENOTFOUND api.x', 'ECONNRESET']) expect(isNetworkError(t), t).toBe(true);
    for (const t of ['You exceeded your current quota', 'schema validation failed', '', null]) expect(isNetworkError(t), String(t)).toBe(false);
  });
});
