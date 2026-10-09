import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createOwner } from '../apps/office-view/owner.mjs';
import { hashPin, verifyPin, createLimiter, readPinHash, writePinHash } from '../scripts/owner-pin.mjs';
import { DecideError } from '../scripts/owner-decide.mjs';
import { makeTmp } from './helpers.mjs';

const UUID = '3f2b1c4e-5a6d-4e7f-8a9b-0c1d2e3f4a5b';
const PIN = 'rahasia-123';

describe('owner-pin', () => {
  it('hash scrypt: PIN benar lolos, salah/kosong/format rusak ditolak, hash berbeda tiap salt', () => {
    const h = hashPin(PIN);
    expect(h).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
    expect(verifyPin(PIN, h)).toBe(true);
    expect(verifyPin('salah-123', h)).toBe(false);
    expect(verifyPin('', h)).toBe(false);
    expect(verifyPin(PIN, 'bukan-hash')).toBe(false);
    expect(hashPin(PIN)).not.toBe(h);
    expect(() => hashPin('123')).toThrow(/PIN harus/);
  });
  it('writePinHash menimpa baris lama dan menjaga isi lain; readPinHash membacanya', () => {
    const f = path.join(makeTmp('aao-pin-'), '.env');
    writeFileSync(f, 'A=1\nAAO_OWNER_PIN_HASH=lama\nB=2\n');
    writePinHash('scrypt$x', f);
    expect(readPinHash(f)).toBe('scrypt$x');
    expect(readPinHash(path.join(makeTmp('aao-pin2-'), 'tidak-ada'))).toBeNull();
  });
  it('limiter mengunci setelah max gagal dan membuka lagi setelah jendela', () => {
    let t = 0; const l = createLimiter({ max: 3, windowMs: 1000, now: () => t });
    for (let i = 0; i < 3; i++) l.fail();
    expect(l.check().locked).toBe(true);
    t = 1001; expect(l.check().locked).toBe(false);
    l.fail(); l.ok(); expect(l.check().locked).toBe(false);
  });
});

describe('tombol owner (HTTP)', () => {
  let srv; let port; let paperclip; let base; let root; let env; let calls; let nowMs; let decideErr;
  const post = (p, body, headers = {}) => fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: Buffer.from(JSON.stringify(body)) });

  beforeAll(async () => {
    root = makeTmp('aao-owner-'); env = path.join(root, '.env'); calls = []; nowMs = 1_000_000; decideErr = null;
    paperclip = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify([{ id: 'c1', name: 'EdukasiAI' }])); });
    await new Promise((r) => paperclip.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${paperclip.address().port}`;
    srv = http.createServer();
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    port = srv.address().port;
    const handle = createOwner({
      base, port, repoRoot: root, envFile: env, now: () => nowMs, limiter: createLimiter({ max: 3, windowMs: 60_000, now: () => nowMs }),
      deps: { httpClient: () => ({}), readOwnerToken: () => 'tok', approvalDir: () => path.join(root, 'approvals'), decide: async (a) => { if (decideErr) throw decideErr; calls.push(a); return { issueStatus: a.decision === 'approved' ? 'done' : 'in_progress', returnedTo: a.decision === 'rejected' ? 'Manager' : null, record: { record_id: 'r1' } }; } },
    });
    const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    srv.on('request', async (req, res) => { const u = new URL(req.url, 'http://x'); if (!(await handle(req, res, u, json))) json(res, 404, {}); });
  });
  afterAll(() => { srv?.close(); paperclip?.close(); });

  it('tanpa PIN terpasang: 503 dengan petunjuk; info menunjukkan pinSet=false', async () => {
    expect((await (await fetch(`http://127.0.0.1:${port}/api/owner/info`)).json()).pinSet).toBe(false);
    const r = await post('/api/owner/decide', { issueId: UUID, decision: 'approve', pin: PIN });
    expect(r.status).toBe(503); expect((await r.json()).error).toMatch(/owner-pin\.mjs set/);
  });

  it('setelah PIN dipasang: validasi masukan, origin, dan PIN salah ditolak sebelum menyentuh decide', async () => {
    writePinHash(hashPin(PIN), env);
    expect((await (await fetch(`http://127.0.0.1:${port}/api/owner/info`)).json()).pinSet).toBe(true);
    expect((await post('/api/owner/decide', { issueId: 'bukan-uuid', decision: 'approve', pin: PIN })).status).toBe(400);
    expect((await post('/api/owner/decide', { issueId: UUID, decision: 'hapus', pin: PIN })).status).toBe(400);
    expect((await post('/api/owner/decide', { issueId: UUID, decision: 'reject', note: '  ', pin: PIN })).status).toBe(400);
    expect((await post('/api/owner/decide', { issueId: UUID, decision: 'reject', note: 'x', stage: 'verifier', pin: PIN })).status).toBe(400);
    expect((await post('/api/owner/decide', { issueId: UUID, decision: 'approve', pin: PIN }, { origin: 'http://evil.example' })).status).toBe(403);
    expect(calls).toEqual([]);
  });

  it('PIN salah 3 kali mengunci (429) walau lalu memakai PIN benar; terbuka lagi setelah jendela', async () => {
    for (let i = 0; i < 3; i++) expect((await post('/api/owner/decide', { issueId: UUID, decision: 'approve', pin: 'salah-000' })).status).toBe(403);
    const locked = await post('/api/owner/decide', { issueId: UUID, decision: 'approve', pin: PIN });
    expect(locked.status).toBe(429);
    expect(calls).toEqual([]);
    nowMs += 61_000;
    expect((await post('/api/owner/decide', { issueId: UUID, decision: 'approve', pin: PIN })).status).toBe(200);
  });

  it('approve dan reject diteruskan ke decide() dengan routing yang benar', async () => {
    calls.length = 0;
    const a = await (await post('/api/owner/decide', { issueId: UUID, decision: 'approve', pin: PIN })).json();
    expect(a).toMatchObject({ ok: true, status: 'done' });
    expect(calls[0]).toMatchObject({ decision: 'approved', routing: null, issueId: UUID });
    const r = await (await post('/api/owner/decide', { issueId: UUID, decision: 'reject', note: 'logo buram', pin: PIN })).json();
    expect(r).toMatchObject({ ok: true, returnedTo: 'Manager' });
    expect(calls[1]).toMatchObject({ decision: 'rejected', note: 'logo buram' });
    expect(calls[1].routing.forceStage).toBeNull();
    expect(calls[1].routing.dir.endsWith(path.join('workspace', 'agent', 'routing'))).toBe(true);
    await post('/api/owner/decide', { issueId: UUID, decision: 'reject', note: 'ganti logo', stage: 'designer', pin: PIN });
    expect(calls[2].routing.forceStage).toBe('designer');
  });

  it('galat decide() (mis. hash paket berubah) dikembalikan sebagai 409, bukan 500', async () => {
    decideErr = new DecideError('isi paket berubah sejak handoff');
    const r = await post('/api/owner/decide', { issueId: UUID, decision: 'approve', pin: PIN });
    expect(r.status).toBe(409); expect((await r.json()).error).toMatch(/berubah sejak handoff/);
    decideErr = null;
  });

  it('batalkan revisi: hanya selama jendela 60 detik, butuh PIN, menulis berkas .cancel', async () => {
    const dir = path.join(root, 'workspace', 'agent', 'routing');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'EDU-77.request.json'), JSON.stringify({ identifier: 'EDU-77', issueId: UUID, reason: 'tes', forceStage: null, requestedAt: nowMs, readyAt: nowMs + 60_000 }));
    const list = await (await fetch(`http://127.0.0.1:${port}/api/owner/routing`)).json();
    expect(list.pending.map((p) => p.identifier)).toContain('EDU-77');
    expect((await post('/api/owner/cancel-revision', { identifier: 'EDU-77', pin: 'salah-000' })).status).toBe(403);
    expect((await post('/api/owner/cancel-revision', { identifier: 'EDU-99', pin: PIN })).status).toBe(404);
    expect((await post('/api/owner/cancel-revision', { identifier: 'EDU-77', pin: PIN })).status).toBe(200);
    expect(existsSync(path.join(dir, 'EDU-77.cancel'))).toBe(true);
    writeFileSync(path.join(dir, 'EDU-78.request.json'), JSON.stringify({ identifier: 'EDU-78', issueId: UUID, reason: 'tes', requestedAt: nowMs - 120_000, readyAt: nowMs - 60_000 }));
    expect((await post('/api/owner/cancel-revision', { identifier: 'EDU-78', pin: PIN })).status).toBe(409);
  });
});
