import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createOwner } from '../apps/office-view/owner.mjs';
import { makeAway, awayView, noteFailure, resumeHold, TOKEN_BREAKER, RESUME_HOLD_MS } from '../scripts/away-core.mjs';
import { makeTmp } from './helpers.mjs';

describe('away-core: ringkasan UI, pemutus token, penahan setelah boot/tidur', () => {
  it('awayView: fase dari berkas away/launcher/jeda', () => {
    expect(awayView({}).phase).toBe('normal');
    expect(awayView({ paused: true }).phase).toBe('jeda');
    expect(awayView({ autoPause: { reason: 'x' } }).phase).toBe('jeda-otomatis');
    const away = makeAway({ nowMs: 1, hours: 9, power: 'sleep' });
    expect(away.power).toBe('sleep'); expect(makeAway({ nowMs: 1, power: 'format-c' }).power).toBeNull();
    // bawaan = jeda (Paperclip tetap hidup); matikan Windows selalu total
    expect(away.mode).toBe('park'); expect(makeAway({ nowMs: 1 }).mode).toBe('park'); expect(makeAway({ nowMs: 1, mode: 'full' }).mode).toBe('full');
    expect(makeAway({ nowMs: 1, power: 'shutdown', mode: 'park' }).mode).toBe('full'); expect(makeAway({ nowMs: 1, mode: 'aneh' }).mode).toBe('park');
    expect(awayView({ away }).phase).toBe('pergi');
    expect(awayView({ away, launcher: { shutting: true, waiting: ['QA', 'Admin Publikasi: posting'], safeToClose: false } })).toMatchObject({ phase: 'menguras', safeToClose: false, waiting: ['QA', 'Admin Publikasi: posting'] });
    expect(awayView({ away, launcher: { shutting: true, waiting: [], safeToClose: true } })).toMatchObject({ phase: 'aman', safeToClose: true });
  });
  it('noteFailure: menjeda hanya bila >= batas dalam jendela waktu; kegagalan lama kedaluwarsa', () => {
    let f = []; let trip = false;
    for (let i = 0; i < TOKEN_BREAKER.maxFails - 1; i++) ({ fails: f, trip } = noteFailure(f, i * 1000));
    expect(trip).toBe(false);
    ({ fails: f, trip } = noteFailure(f, 10_000)); expect(trip).toBe(true);
    ({ fails: f, trip } = noteFailure(f, TOKEN_BREAKER.windowMs + 100_000)); expect(trip).toBe(false); expect(f).toHaveLength(1);
  });
  it('resumeHold: menahan setelah proses dinyalakan dan setelah bangun dari tidur, lalu lepas', () => {
    expect(resumeHold({ bootMs: 0, nowMs: RESUME_HOLD_MS - 1 })).toBe(true);
    expect(resumeHold({ bootMs: 0, nowMs: RESUME_HOLD_MS })).toBe(false);
    expect(resumeHold({ bootMs: 0, resumeUntilMs: 5_000_000, nowMs: 4_000_000 })).toBe(true);
    expect(resumeHold({ bootMs: 0, resumeUntilMs: 5_000_000, nowMs: 5_000_000 })).toBe(false);
  });
});

describe('tombol Matikan aman (HTTP /api/owner/away)', () => {
  let srv; let port; let root; let ran;
  const post = (p, body, headers = {}) => fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: Buffer.from(JSON.stringify(body)) });
  const get = async () => (await fetch(`http://127.0.0.1:${port}/api/owner/away`)).json();
  const wr = (rel, obj) => { const f = path.join(root, ...rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(obj)); };

  beforeAll(async () => {
    root = makeTmp('aao-away-'); ran = [];
    srv = http.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r)); port = srv.address().port;
    const handle = createOwner({ base: 'http://127.0.0.1:1', port, repoRoot: root, envFile: path.join(root, '.env'), deps: { runAway: (args) => ran.push(args) } });
    const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    srv.on('request', async (req, res) => { const u = new URL(req.url, 'http://x'); if (!(await handle(req, res, u, json))) json(res, 404, {}); });
  });
  afterAll(() => srv?.close());

  it('GET: normal tanpa berkas; berubah mengikuti away.json, jeda, dan status pengawas', async () => {
    expect((await get()).phase).toBe('normal');
    wr(['workspace', 'orchestrator-settings.json'], { paused: true }); expect((await get()).phase).toBe('jeda');
    wr(['workspace', 'away.json'], makeAway({ nowMs: Date.now(), hours: 9 })); expect((await get()).phase).toBe('pergi');
    wr(['workspace', 'launcher-status.json'], { shutting: true, waiting: ['QA'], safeToClose: false }); expect(await get()).toMatchObject({ phase: 'menguras', waiting: ['QA'], safeToClose: false });
    wr(['workspace', 'launcher-status.json'], { shutting: true, waiting: [], safeToClose: true }); expect(await get()).toMatchObject({ phase: 'aman', safeToClose: true });
  });
  it('POST: masukan divalidasi, origin asing ditolak; aksi sah menjalankan away-mode dengan argumen yang tepat', async () => {
    expect((await post('/api/owner/away', { action: 'x' })).status).toBe(400);
    expect((await post('/api/owner/away', { action: 'on', hours: 100 })).status).toBe(400);
    expect((await post('/api/owner/away', { action: 'on', hours: -1 })).status).toBe(400);
    expect((await post('/api/owner/away', { action: 'on', power: 'format-c' })).status).toBe(400);
    expect((await post('/api/owner/away', { action: 'on', mode: 'hapus' })).status).toBe(400);
    expect((await post('/api/owner/away', { action: 'on' }, { origin: 'http://evil.example' })).status).toBe(403);
    expect(ran).toEqual([]);
    // keadaan bersih (tes sebelumnya meninggalkan away.json/jeda): hanya satu "on" yang menjalankan away-mode
    for (const rel of [['workspace', 'away.json'], ['workspace', 'orchestrator-settings.json'], ['workspace', 'launcher-status.json']]) rmSync(path.join(root, ...rel), { force: true });
    const first = await (await post('/api/owner/away', { action: 'on', hours: 9, power: 'sleep' })).json();
    expect(first).toMatchObject({ ok: true, started: true });
    wr(['workspace', 'away.json'], makeAway({ nowMs: Date.now(), hours: 9 })); // away-mode menulisnya segera setelah dimulai
    const second = await (await post('/api/owner/away', { action: 'on' })).json(); // klik ganda
    expect(second).toMatchObject({ ok: true, started: false, already: true });
    expect((await post('/api/owner/away', { action: 'off' })).status).toBe(200);
    expect(ran).toEqual([['on', '--hours', '9', '--power', 'sleep'], ['off']]);
  });
});
