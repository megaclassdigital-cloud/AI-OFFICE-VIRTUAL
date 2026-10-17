import { describe, it, expect } from 'vitest';
import { createGate, sanitizeBody, reviewMayGetAny, reviewMayImage, createLimiter } from '../apps/office-view/gate.mjs';

const SECRET = 'a'.repeat(64); const KEY = 'kunci-review-uji-0123456789';
const env = () => ({ AAO_SESSION_SECRET: SECRET, AAO_REVIEW_KEY: KEY });
const mkReq = ({ method = 'GET', headers = {}, remote = '127.0.0.1', host = '127.0.0.1:3190' } = {}) => ({ method, headers: { host, ...headers }, socket: { remoteAddress: remote } });
const mkRes = () => { const r = { code: null, headers: null, body: '', writeHead(c, h) { r.code = c; r.headers = h; }, end(b) { r.body = b ?? ''; } }; return r; };
const json = (res, code, body) => { res.writeHead(code, {}); res.end(JSON.stringify(body)); };
const call = (gate, req, url) => { const res = mkRes(); const out = gate(req, res, new URL(url, 'http://x'), json); return { out, res }; };
const tunnel = (extra = {}) => mkReq({ headers: { 'x-forwarded-for': '1.2.3.4', 'cf-connecting-ip': '1.2.3.4', host: 'demo.example.com', ...extra } });

describe('gerbang akses', () => {
  const gate = createGate({ port: 3190, env });
  const reviewCookie = () => {
    const { res } = call(gate, tunnel(), `/review?key=${KEY}`);
    expect(res.code).toBe(302);
    return String(res.headers['set-cookie']).split(';')[0];
  };

  it('desktop lokal: lolos tanpa perubahan (perilaku lama)', () => {
    const { out } = call(gate, mkReq(), '/api/inspect/agent?name=QA');
    expect(out.handled).toBe(false); expect(out.role).toBe('local');
  });
  it('lewat tunnel tanpa sesi: ditolak 401 (header proksi membatalkan status lokal)', () => {
    for (const url of ['/', '/api/inspect/agent?name=QA', '/api/snapshot', '/api/inspect/approvals']) {
      const { out, res } = call(gate, tunnel(), url); expect([out.handled, res.code]).toEqual([true, 401]);
    }
    // Host asing tanpa header proksi juga bukan lokal
    expect(call(gate, mkReq({ host: 'demo.example.com' }), '/api/snapshot').res.code).toBe(401);
  });
  it('kunci review: salah => 403, benar => 302 + cookie HttpOnly; Secure bila HTTPS di depan', () => {
    expect(call(gate, tunnel(), '/review?key=salah').res.code).toBe(403);
    expect(call(gate, tunnel(), '/review').res.code).toBe(403);
    const { res } = call(gate, tunnel({ 'x-forwarded-proto': 'https' }), `/review?key=${KEY}`);
    expect(res.code).toBe(302); expect(res.headers.location).toBe('/');
    expect(String(res.headers['set-cookie'])).toMatch(/HttpOnly/); expect(String(res.headers['set-cookie'])).toMatch(/Secure/);
  });
  it('percobaan kunci salah dibatasi (429)', () => {
    const g = createGate({ port: 3190, env, now: () => 1_700_000_000_000 });
    let last; for (let i = 0; i < 12; i++) last = call(g, tunnel(), '/review?key=salah').res.code;
    expect(last).toBe(429);
  });
  it('peran review: rute yang diizinkan lolos; rute internal dan semua non-GET ditolak', () => {
    const cookie = reviewCookie();
    const rv = (url, method = 'GET') => call(gate, tunnel({ cookie }), url, method);
    const withM = (method, url) => { const res = mkRes(); const out = gate(mkReq({ method, headers: { cookie, 'x-forwarded-for': '1.2.3.4', host: 'demo.example.com' } }), res, new URL(url, 'http://x'), json); return { out, res }; };
    for (const ok of ['/', '/office.js', '/api/layout', '/api/snapshot', '/api/events?since=3', '/api/inspect/board?limit=3', '/api/inspect/production?prod=EDU-97', '/api/inspect/autopost', '/api/inspect/autonomy', '/api/inspect/agent?name=QA', '/api/inspect/approvals']) expect(rv(ok).out.handled, ok).toBe(false);
    for (const bad of ['/api/inspect/file?path=x', '/api/inspect/files?prod=EDU-97', '/api/inspect/issue?id=1', '/api/talk/thread?issue=1', '/api/owner/decide']) { const r = rv(bad); expect([r.out.handled, r.res.code], bad).toEqual([true, 403]); }
    for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) { const r = withM(m, '/api/talk'); expect([r.out.handled, r.res.code], m).toEqual([true, 405]); }
  });
  it('whoami: lokal = owner, review = review (hanya-baca), anonim = null', () => {
    const cookie = reviewCookie();
    expect(JSON.parse(call(gate, mkReq(), '/api/access/whoami').res.body)).toMatchObject({ role: 'owner', readOnly: false });
    expect(JSON.parse(call(gate, tunnel({ cookie }), '/api/access/whoami').res.body)).toMatchObject({ role: 'review', readOnly: true });
    expect(JSON.parse(call(gate, tunnel(), '/api/access/whoami').res.body)).toMatchObject({ role: null });
  });
  it('tanpa rahasia di .env: kunci review tidak pernah cocok (gagal-tertutup)', () => {
    const g = createGate({ port: 3190, env: () => ({}) });
    expect(call(g, tunnel(), '/review?key=').res.code).toBe(403);
    expect(call(g, tunnel(), '/api/snapshot').res.code).toBe(401);
  });
  it('cookie palsu atau diubah perannya ditolak', () => {
    expect(call(gate, tunnel({ cookie: 'aao_session=owner.99999999999999.palsu' }), '/api/inspect/approvals').res.code).toBe(401);
  });
});

describe('penyaringan badan untuk klien', () => {
  it('gambar: hanya render konten, bukan bukti posting', () => {
    expect(reviewMayImage('runs/EDU-97/revision-1/render/slide-01.png')).toBe(true);
    expect(reviewMayImage('runs/EDU-27/render/contact-sheet.png')).toBe(true);
    for (const bad of ['autopost/evidence/EDU-97/tiktok/x/galat.png', 'runs/EDU-97/../../x.png', '../secret.png', 'runs/EDU-97/arsip/qa/x.png', 'runs/EDU-97/render/x.json']) expect(reviewMayImage(bad), bad).toBe(false);
  });
  it('events/snapshot: kutipan komentar dibuang, kejadian lain tetap', () => {
    const b = sanitizeBody('/api/events', { epoch: 1, seq: 9, connected: true, error: 'rahasia', events: [{ type: 'comment', seq: 1, agentId: 'a', issue: { identifier: 'EDU-1', title: 'T', id: 'uuid' }, excerpt: 'RENCANA INTERNAL', fromOwner: true }, { type: 'agent.state', seq: 2, state: 'working' }] });
    expect(JSON.stringify(b)).not.toMatch(/RENCANA INTERNAL|rahasia|uuid|fromOwner/);
    expect(b.events[1]).toEqual({ type: 'agent.state', seq: 2, state: 'working' });
  });
  it('autopost: tanpa jalur bukti, tanpa pesan galat', () => {
    const b = sanitizeBody('/api/inspect/autopost', { status: { paused: false, cooldownHours: 3, approvedWaiting: 0, at: 'x', blocked: [{ reasons: ['internal'] }], platforms: { instagram: { live: true, postedTotal: 1, lastPostAt: 'a', nextAllowedAt: 'b', remainingText: 'x' } } }, recent: [{ content: 'EDU-97', platform: 'tiktok', mode: 'live', status: 'gagal', at: 't', error: 'locator.click: ...', evidenceDir: 'workspace\\agent\\x' }] });
    expect(JSON.stringify(b)).not.toMatch(/locator|evidence|workspace|internal/);
    expect(b.recent[0]).toEqual({ content: 'EDU-97', platform: 'tiktok', mode: 'live', status: 'gagal', at: 't' });
  });
  it('otonom: tanpa nama berkas brief; produksi: rencana Manager dibuang; info owner/talk selalu nonaktif', () => {
    const a = sanitizeBody('/api/inspect/autonomy', { status: { at: 1, enabled: true, code: 'sibuk', reason: 'r', settings: { maxPerDay: 3 } }, recent: [{ atMs: 5, file: 'auto-1-brief.md', withInsights: true }], insights: { at: 2, source: 's', posts: 7, analysis: { n: 7, notes: ['n'], best: [], recentTitles: ['judul pribadi'] } } });
    expect(JSON.stringify(a)).not.toMatch(/auto-1-brief|judul pribadi/);
    const p = sanitizeBody('/api/inspect/production', { title: 'T', manager: { rencana: 'internal' }, master: { id: 'uuid', status: 'done', hasHandoff: true } });
    expect(JSON.stringify(p)).not.toMatch(/internal|uuid/);
    expect(sanitizeBody('/api/owner/info', { enabled: true })).toEqual({ enabled: false });
    expect(sanitizeBody('/api/talk/info', { enabled: true })).toEqual({ enabled: false });
  });
  it('daftar rute klien tidak memuat jalur internal', () => {
    for (const p of ['/api/inspect/file', '/api/inspect/files', '/api/inspect/issue', '/api/talk', '/api/owner/decide']) expect(reviewMayGetAny(p), p).toBe(false);
  });
  it('pembatas laju: jendela bergeser', () => {
    let t = 0; const lim = createLimiter({ max: 2, windowMs: 1000, now: () => t });
    expect([lim('a'), lim('a'), lim('a')]).toEqual([true, true, false]);
    t = 2000; expect(lim('a')).toBe(true);
  });
});
