// Test Office View: denah, logika dunia, bridge (Paperclip palsu), replay, server.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createWorld, applyEvent, stepWorld, planPath, roomAt, addOwner, homeOf, describeEvent } from '../apps/office-view/public/world.js';
import { createBridge } from '../apps/office-view/bridge.mjs';
import { repoRoot } from './helpers.mjs';

const layout = JSON.parse(readFileSync(path.join(repoRoot, 'divisions/edukasiai/office/layout.json'), 'utf8'));
const replay = readFileSync(path.join(repoRoot, 'fixtures/office-events/demo-carousel.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

const mkWorld = () => { const w = createWorld(layout); addOwner(w); return w; };
const AG = {
  r: { agentId: 'a-r', name: 'Researcher', role: 'researcher' }, v: { agentId: 'a-v', name: 'Verifier', role: 'qa' },
  c: { agentId: 'a-c', name: 'Copywriter', role: 'general' }, d: { agentId: 'a-d', name: 'Designer', role: 'designer' }, q: { agentId: 'a-q', name: 'QA', role: 'qa' },
};
const seed = (w) => { for (const a of Object.values(AG)) applyEvent(w, { type: 'agent.state', ...a, state: 'idle' }, { instant: true }); };
const run = (w, secs, dt = 0.05) => { for (let t = 0; t < secs; t += dt) stepWorld(w, dt); };
const char = (w, id) => w.chars.get(id);
/** Jalankan dunia sampai `pred` benar (maks `max` detik); kembalikan true bila tercapai. */
const until = (w, pred, max = 30, dt = 0.05) => { for (let t = 0; t < max; t += dt) { stepWorld(w, dt); if (pred()) return true; } return false; };
const issue = { id: 'i1', identifier: 'EDU-3', title: 'Uji' };

describe('denah (layout.json)', () => {
  it('8 ruang sesuai OFFICE-VIEW.md', () => {
    expect(layout.rooms.map((r) => r.id).sort()).toEqual(['bug', 'lounge', 'owner', 'papan', 'qa', 'rapat', 'riset', 'studio']);
  });
  it('semua meja, kursi, pintu, dan slot berada di dalam kanvas dan di dalam ruang yang benar', () => {
    const inside = (p) => p.x >= 0 && p.x <= layout.canvas.width && p.y >= 0 && p.y <= layout.canvas.height;
    for (const d of layout.desks) {
      expect(inside(d.seat), d.key).toBe(true);
      expect(roomAt(layout, d.seat)?.id, `${d.key} seat`).toBe(d.room);
      expect(roomAt(layout, d.stand)?.id, `${d.key} stand`).toBe(d.room);
    }
    for (const s of layout.loungeSlots) expect(roomAt(layout, s)?.id).toBe('lounge');
    for (const s of layout.bugSlots) expect(roomAt(layout, s)?.id).toBe('bug');
    expect(roomAt(layout, layout.ownerSeat)?.id).toBe('owner');
    expect(roomAt(layout, layout.ownerDrop)?.id).toBe('owner');
  });
  it('ruang tanpa sumber data nyata ditandai tidak live (segera aktif)', () => {
    expect(layout.rooms.filter((r) => !r.live).map((r) => r.id).sort()).toEqual(['papan']);
  });
});

describe('world: gerak dan pemetaan', () => {
  it('planPath keluar lewat pintu, koridor, lalu masuk ruang tujuan', () => {
    const p = planPath(layout, layout.desks[0].seat, layout.loungeSlots[0]);
    const rooms = p.map((pt) => roomAt(layout, pt)?.id ?? 'koridor');
    expect(rooms[0]).toBe('riset');
    expect(rooms).toContain('koridor');
    expect(rooms.at(-1)).toBe('lounge');
    expect(p.some((pt) => pt.y === layout.corridorY)).toBe(true);
  });

  it('snapshot awal (instant): agent langsung di tempatnya, tanpa berjalan', () => {
    const w = mkWorld();
    applyEvent(w, { type: 'agent.state', ...AG.c, state: 'working', issue }, { instant: true });
    const c = char(w, 'a-c');
    expect(c.moving).toBe(false);
    expect(c.path).toEqual([]);
    expect({ x: c.x, y: c.y }).toEqual(layout.desks.find((d) => d.key === 'copywriter').seat);
  });

  it('run dimulai: berjalan dari Lounge ke mejanya (Studio Konten), bubble ⌨️ + ID issue; run selesai: kembali ke Lounge ☕', () => {
    const w = mkWorld(); seed(w);
    expect(roomAt(layout, char(w, 'a-c'))?.id).toBe('lounge');
    applyEvent(w, { type: 'agent.state', ...AG.c, state: 'working', issue });
    run(w, 0.5);
    expect(char(w, 'a-c').moving).toBe(true);
    expect(char(w, 'a-c').bubble.emoji).toBe('⌨️');
    expect(char(w, 'a-c').bubble.text).toContain('EDU-3');
    run(w, 15);
    expect(roomAt(layout, char(w, 'a-c'))?.id).toBe('studio');
    expect(char(w, 'a-c').moving).toBe(false);
    applyEvent(w, { type: 'agent.state', ...AG.c, state: 'idle' });
    expect(char(w, 'a-c').bubble.emoji).toBe('☕');
    run(w, 15);
    expect(roomAt(layout, char(w, 'a-c'))?.id).toBe('lounge');
  });

  it('handoff: agent asal membawa dokumen ke meja tujuan, lalu kembali', () => {
    const w = mkWorld(); seed(w);
    applyEvent(w, { type: 'agent.state', ...AG.r, state: 'working', issue }, { instant: true });
    applyEvent(w, { type: 'agent.state', ...AG.v, state: 'working', issue }, { instant: true });
    applyEvent(w, { type: 'handoff', from: 'a-r', to: 'a-v', issue });
    run(w, 0.3);
    const r = char(w, 'a-r');
    expect(r.queue.length + r.path.length).toBeGreaterThan(0);
    run(w, 0.5);
    expect(char(w, 'a-r').carry).toBe(true);
    expect(until(w, () => char(w, 'a-v').bubble?.emoji === '📄', 10)).toBe(true);
    run(w, 10);
    expect(char(w, 'a-r').carry).toBe(false);
    const seat = layout.desks.find((d) => d.key === 'researcher').seat;
    expect(Math.hypot(char(w, 'a-r').x - seat.x, char(w, 'a-r').y - seat.y)).toBeLessThan(4);
  });

  it('QA gagal (❌): QA membawa dokumen kembali ke meja Copywriter', () => {
    const w = mkWorld(); seed(w);
    applyEvent(w, { type: 'agent.state', ...AG.q, state: 'working', issue }, { instant: true });
    applyEvent(w, { type: 'handoff', from: 'a-q', to: 'a-c', issue, emoji: '❌' });
    expect(until(w, () => char(w, 'a-c').bubble?.emoji === '❌' && char(w, 'a-q').carry, 20)).toBe(true);
    expect(roomAt(layout, char(w, 'a-q'))?.id).toBe('studio');
  });

  it('deliver: agent meletakkan paket di Meja Owner dan badge naik saat tiba, bukan sebelumnya', () => {
    const w = mkWorld(); seed(w);
    applyEvent(w, { type: 'agent.state', ...AG.q, state: 'working', issue }, { instant: true });
    applyEvent(w, { type: 'deliver', agentId: 'a-q', issue, count: 1 });
    run(w, 0.5);
    expect(w.ownerCount).toBe(0);
    expect(until(w, () => w.ownerCount === 1, 20)).toBe(true);
    expect(roomAt(layout, char(w, 'a-q'))?.id).toBe('owner');
    expect(until(w, () => char(w, 'a-q').bubble?.emoji === '✋', 5)).toBe(true);
  });

  it('run gagal → Pojok Bug 🐞; needs_human (alert) → Pojok Bug ⚠️; paused → tidur di meja 😴', () => {
    const w = mkWorld(); seed(w);
    applyEvent(w, { type: 'agent.state', ...AG.v, state: 'failed', reason: 'timeout' });
    applyEvent(w, { type: 'agent.state', ...AG.r, state: 'alert', reason: 'needs_human' });
    applyEvent(w, { type: 'agent.state', ...AG.d, state: 'paused', reason: 'guard' });
    expect(char(w, 'a-v').bubble.emoji).toBe('🐞');
    expect(char(w, 'a-r').bubble.emoji).toBe('⚠️');
    expect(char(w, 'a-d').bubble.emoji).toBe('😴');
    run(w, 20);
    expect(roomAt(layout, char(w, 'a-v'))?.id).toBe('bug');
    expect(roomAt(layout, char(w, 'a-r'))?.id).toBe('bug');
    expect(roomAt(layout, char(w, 'a-d'))?.id).toBe('studio');
  });

  it('karakter yang istirahat di Lounge tidak pernah menumpuk di titik yang sama (selama 3 menit)', () => {
    const w = mkWorld(); seed(w);
    for (let t = 0; t < 180; t += 0.05) {
      stepWorld(w, 0.05);
      const still = [...w.chars.values()].filter((c) => !c.isOwner && !c.moving && roomAt(layout, c)?.id === 'lounge');
      for (let i = 0; i < still.length; i++) for (let j = i + 1; j < still.length; j++) {
        expect(Math.hypot(still[i].x - still[j].x, still[i].y - still[j].y), `${still[i].name}/${still[j].name} @${t.toFixed(1)}`).toBeGreaterThan(30);
      }
    }
  });

  it('komentar baru: bubble 💬', () => {
    const w = mkWorld(); seed(w);
    applyEvent(w, { type: 'comment', agentId: 'a-c', issue });
    expect(char(w, 'a-c').bubble.emoji).toBe('💬');
  });

  it('agent yang tidak punya meja khusus tetap aman (tinggal di Lounge)', () => {
    const w = mkWorld();
    applyEvent(w, { type: 'agent.state', agentId: 'x', name: 'Analis Baru', role: 'analyst', state: 'working', issue }, { instant: true });
    expect(roomAt(layout, homeOf(w, char(w, 'x')))?.id).toBe('lounge');
  });

  it('log berbahasa Indonesia', () => {
    const w = mkWorld(); seed(w);
    expect(describeEvent(w, { type: 'agent.state', ...AG.c, state: 'working', issue }, '16:51')).toBe('16:51 Copywriter mengambil EDU-3 Uji');
    expect(describeEvent(w, { type: 'handoff', from: 'a-r', to: 'a-v', issue }, '16:52')).toContain('Researcher menyerahkan EDU-3 ke Verifier');
  });
});

// ───────── bridge dengan Paperclip palsu ─────────
function fakePaperclip() {
  const S = { companies: [{ id: 'co', name: 'EdukasiAI' }, { id: 'mega', name: 'Office Mega Class' }], agents: [], issues: [], runs: [], comments: {}, down: false, calls: [] };
  const mk = (id, name, role, status = 'idle') => ({ id, name, role, status });
  S.agents = [mk('a-r', 'Researcher', 'researcher'), mk('a-c', 'Copywriter', 'general'), mk('a-q', 'QA', 'qa')];
  const fetchImpl = async (url, init = {}) => {
    S.calls.push({ method: init.method ?? 'GET', url });
    if (S.down) throw new Error('ECONNREFUSED');
    const p = new URL(url).pathname.replace(/^\/api/, '');
    const ok = (b) => ({ ok: true, status: 200, json: async () => b });
    if (p === '/companies') return ok(S.companies);
    if (p === '/companies/co/agents') return ok(S.agents);
    if (p === '/companies/co/issues') return ok(S.issues);
    if (p.startsWith('/companies/co/heartbeat-runs')) return ok(S.runs);
    let m;
    if ((m = /^\/issues\/([^/]+)\/comments$/.exec(p))) return ok(S.comments[m[1]] ?? []);
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { S, fetchImpl };
}
const iss = (id, over = {}) => ({ id, identifier: id.toUpperCase(), title: `Judul ${id}`, status: 'todo', assigneeAgentId: null, updatedAt: new Date().toISOString(), lastActivityAt: new Date().toISOString(), ...over });

describe('office-bridge (Paperclip palsu)', () => {
  it('pembacaan pertama = snapshot keadaan terkini, tanpa event gerak', async () => {
    const { S, fetchImpl } = fakePaperclip();
    S.runs = [{ id: 'run1', agentId: 'a-c', status: 'running', startedAt: new Date().toISOString() }];
    S.issues = [iss('i1', { status: 'in_progress', assigneeAgentId: 'a-c', executionRunId: 'run1' })];
    const b = createBridge({ fetchImpl });
    await b.poll();
    const snap = b.snapshot();
    expect(snap.connected).toBe(true);
    expect(snap.seq).toBe(0);
    const c = snap.events.find((e) => e.type === 'agent.state' && e.agentId === 'a-c');
    expect(c).toMatchObject({ state: 'working', issue: { identifier: 'I1' } });
    expect(b.eventsSince(0).events).toEqual([]);
  });

  it('run mulai dan selesai menghasilkan event agent.state', async () => {
    const { S, fetchImpl } = fakePaperclip();
    const b = createBridge({ fetchImpl });
    await b.poll();
    S.runs = [{ id: 'r1', agentId: 'a-r', status: 'running', startedAt: new Date().toISOString() }];
    S.issues = [iss('i1', { status: 'in_progress', assigneeAgentId: 'a-r', executionRunId: 'r1' })];
    await b.poll();
    S.runs = [{ id: 'r1', agentId: 'a-r', status: 'succeeded', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() }];
    await b.poll();
    const ev = b.eventsSince(0).events.filter((e) => e.type === 'agent.state');
    expect(ev.map((e) => `${e.agentId}:${e.state}`)).toEqual(['a-r:working', 'a-r:idle']);
    expect(ev[0].issue.identifier).toBe('I1');
  });

  it('assignee berpindah → handoff; masuk in_review → deliver + antrean owner', async () => {
    const { S, fetchImpl } = fakePaperclip();
    S.issues = [iss('i1', { status: 'in_progress', assigneeAgentId: 'a-r' })];
    const b = createBridge({ fetchImpl });
    await b.poll();
    S.issues = [iss('i1', { status: 'in_progress', assigneeAgentId: 'a-c' })];
    await b.poll();
    S.issues = [iss('i1', { status: 'in_review', assigneeAgentId: 'a-c' })];
    await b.poll();
    const types = b.eventsSince(0).events.map((e) => e.type);
    expect(types).toContain('handoff');
    expect(b.eventsSince(0).events.find((e) => e.type === 'handoff')).toMatchObject({ from: 'a-r', to: 'a-c' });
    const del = b.eventsSince(0).events.find((e) => e.type === 'deliver');
    expect(del).toMatchObject({ agentId: 'a-c', count: 1 });
  });

  it('komentar baru → event comment (komentar lama tidak diulang)', async () => {
    const { S, fetchImpl } = fakePaperclip();
    S.issues = [iss('i1', { status: 'in_progress', assigneeAgentId: 'a-c' })];
    S.comments.i1 = [{ id: 'c0', authorAgentId: 'a-c' }];
    const b = createBridge({ fetchImpl });
    await b.poll();
    expect(b.eventsSince(0).events).toEqual([]);
    S.comments.i1 = [{ id: 'c0', authorAgentId: 'a-c' }, { id: 'c1', authorAgentId: 'a-c' }];
    await b.poll();
    await b.poll();
    expect(b.eventsSince(0).events.filter((e) => e.type === 'comment')).toHaveLength(1);
  });

  it('agent di-pause → paused; run gagal baru → failed; issue blocked → alert', async () => {
    const { S, fetchImpl } = fakePaperclip();
    const b = createBridge({ fetchImpl });
    await b.poll();
    S.agents[0] = { ...S.agents[0], status: 'paused', pauseReason: 'guard' };
    S.runs = [{ id: 'rf', agentId: 'a-c', status: 'failed', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), error: 'boom' }];
    S.issues = [iss('i2', { status: 'blocked', assigneeAgentId: 'a-q' })];
    await b.poll();
    const st = Object.fromEntries(b.eventsSince(0).events.filter((e) => e.type === 'agent.state').map((e) => [e.agentId, e.state]));
    expect(st).toEqual({ 'a-r': 'paused', 'a-c': 'failed', 'a-q': 'alert' });
  });

  it('kegagalan lama (di luar jendela 15 menit) tidak memunculkan Pojok Bug', async () => {
    const { S, fetchImpl } = fakePaperclip();
    const old = new Date(Date.now() - 3 * 3600_000).toISOString();
    S.runs = [{ id: 'rf', agentId: 'a-c', status: 'failed', startedAt: old, finishedAt: old }];
    const b = createBridge({ fetchImpl });
    await b.poll();
    expect(b.snapshot().events.find((e) => e.agentId === 'a-c').state).toBe('idle');
  });

  it('agent berstatus error tetap di Pojok Bug (failed) sampai error dibersihkan, lalu kembali idle', async () => {
    const { S, fetchImpl } = fakePaperclip();
    const old = new Date(Date.now() - 5 * 3600_000).toISOString();
    S.runs = [{ id: 'rf', agentId: 'a-q', status: 'failed', startedAt: old, finishedAt: old, errorCode: 'setup_failed' }];
    S.agents[2] = { ...S.agents[2], status: 'error', errorReason: 'Command failed' };
    const b = createBridge({ fetchImpl });
    await b.poll();
    expect(b.snapshot().events.find((e) => e.agentId === 'a-q')).toMatchObject({ state: 'failed', reason: 'setup_failed' });
    S.agents[2] = { ...S.agents[2], status: 'idle', errorReason: null };
    await b.poll();
    expect(b.eventsSince(0).events.filter((e) => e.agentId === 'a-q').map((e) => e.state)).toEqual(['idle']);
  });

  it('poll lambat yang gagal sekali lalu pulih tidak menaikkan epoch (tidak ada teleport di klien)', async () => {
    const { S, fetchImpl } = fakePaperclip();
    const b = createBridge({ fetchImpl });
    await b.poll();
    const e0 = b.status().epoch;
    S.down = true; await b.poll(); S.down = false;
    S.runs = [{ id: 'r9', agentId: 'a-r', status: 'running', startedAt: new Date().toISOString() }];
    await b.poll();
    expect(b.status()).toMatchObject({ connected: true, epoch: e0 });
    expect(b.eventsSince(0).events.map((e) => `${e.agentId}:${e.state}`)).toEqual(['a-r:working']);
  });

  it('Paperclip mati: connected=false tanpa crash; pulih: epoch naik agar klien membaca ulang keadaan', async () => {
    const { S, fetchImpl } = fakePaperclip();
    const b = createBridge({ fetchImpl });
    await b.poll();
    const e0 = b.status().epoch;
    S.down = true;
    await b.poll();
    await b.poll();
    expect(b.status().connected).toBe(true); // satu-dua poll gagal belum dianggap putus
    expect(b.status().epoch).toBe(e0);
    await b.poll();
    expect(b.status()).toMatchObject({ connected: false });
    expect(b.status().error).toMatch(/ECONNREFUSED/);
    S.down = false;
    await b.poll();
    expect(b.status().connected).toBe(true);
    expect(b.status().epoch).toBe(e0 + 1);
  });

  it('READ-ONLY: semua permintaan ke Paperclip adalah GET; company Office Mega Class tidak pernah disentuh', async () => {
    const { S, fetchImpl } = fakePaperclip();
    S.issues = [iss('i1', { status: 'in_progress', assigneeAgentId: 'a-r' })];
    const b = createBridge({ fetchImpl });
    for (let i = 0; i < 3; i++) await b.poll();
    expect(S.calls.length).toBeGreaterThan(5);
    expect(S.calls.every((c) => c.method === 'GET')).toBe(true);
    expect(S.calls.some((c) => c.url.includes('/mega'))).toBe(false);
  });
});

// ───────── replay ─────────
describe('replay demo-carousel.jsonl', () => {
  it('2–3 menit, waktu menaik, tipe event dikenal', () => {
    const known = new Set(['agent.state', 'handoff', 'comment', 'deliver', 'owner.queue', 'owner.decide', 'board.add', 'end']);
    let last = -1;
    for (const e of replay) { expect(known.has(e.type), e.type).toBe(true); expect(e.t).toBeGreaterThanOrEqual(last); last = e.t; }
    expect(last).toBeGreaterThanOrEqual(120);
    expect(last).toBeLessThanOrEqual(200);
  });
  it('alur lengkap: riset → handoff → verifikasi → copy → desain → QA gagal+revisi → QA lolos → meja owner → approve → papan → lounge', () => {
    const ho = replay.filter((e) => e.type === 'handoff').map((e) => `${e.from}>${e.to}${e.emoji ?? ''}`);
    expect(ho).toEqual(['sim-researcher>sim-verifier', 'sim-verifier>sim-copywriter', 'sim-copywriter>sim-designer', 'sim-designer>sim-qa', 'sim-qa>sim-copywriter❌', 'sim-copywriter>sim-qa']);
    expect(replay.some((e) => e.type === 'deliver')).toBe(true);
    expect(replay.some((e) => e.type === 'owner.decide' && e.decision === 'approved')).toBe(true);
    expect(replay.some((e) => e.type === 'board.add')).toBe(true);
    expect(replay.some((e) => e.type === 'agent.state' && e.state === 'failed')).toBe(true);
  });
  it('semua agent yang dirujuk didefinisikan pada t=0, dan memakai jalur applyEvent yang sama dengan live', () => {
    const w = mkWorld();
    for (const e of replay.filter((x) => x.t === 0)) applyEvent(w, e, { instant: true });
    const ids = new Set(w.chars.keys());
    for (const e of replay) for (const id of [e.agentId, e.from, e.to].filter(Boolean)) expect(ids.has(id), id).toBe(true);
    // putar ulang sesuai waktu (sama dengan klien): event diterapkan saat jamnya tiba
    let clock = 0; const pending = replay.filter((x) => x.t > 0 && x.type !== 'end'); let sawQueue = false;
    while (pending.length) {
      stepWorld(w, 0.05); clock += 0.05;
      while (pending.length && pending[0].t <= clock) applyEvent(w, pending.shift());
      if (w.ownerCount === 1) sawQueue = true;
    }
    run(w, 20);
    expect(sawQueue).toBe(true);
    expect(w.ownerCount).toBe(0);
    expect(w.board.length).toBe(1);
    for (const c of w.chars.values()) if (!c.isOwner) expect(roomAt(layout, c)?.id, c.name).toBe('lounge');
  });
});

// ───────── server ─────────
describe('office-view server', () => {
  let srv; let base; let fake;
  beforeAll(async () => {
    fake = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(req.url.endsWith('/companies') ? '[]' : '{}'); });
    await new Promise((r) => fake.listen(0, '127.0.0.1', r));
    process.env.AAO_API_BASE = `http://127.0.0.1:${fake.address().port}`;
    const mod = await import('../apps/office-view/server.mjs');
    srv = mod.server;
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${srv.address().port}`;
  });
  afterAll(async () => { await new Promise((r) => srv.close(r)); await new Promise((r) => fake.close(r)); });

  it('hanya mendengar di loopback; metode tulis ditolak 405', async () => {
    expect(srv.address().address).toBe('127.0.0.1');
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) expect((await fetch(`${base}/api/status`, { method })).status).toBe(405);
  });
  it('layout, replay, status, dan halaman utama terlayani', async () => {
    expect((await (await fetch(`${base}/api/layout`)).json()).rooms).toHaveLength(8);
    expect((await (await fetch(`${base}/api/replay`)).json()).events.length).toBeGreaterThan(30);
    expect(await (await fetch(`${base}/api/status`)).json()).toHaveProperty('connected');
    const html = await (await fetch(`${base}/`)).text();
    expect(html).toContain('MODE: LIVE');
  });
  it('tidak bisa keluar dari folder public', async () => {
    for (const p of ['/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/package.json']) {
      const r = await fetch(base + p);
      expect([403, 404]).toContain(r.status);
      expect((await r.text()).includes('devDependencies')).toBe(false);
    }
  });
  it('kode klien tidak memuat aksi tulis, LLM, atau permintaan ke luar 127.0.0.1', () => {
    const src = ['office.js', 'world.js', 'index.html'].map((f) => readFileSync(path.join(repoRoot, 'apps/office-view/public', f), 'utf8')).join('\n');
    expect(src).not.toMatch(/method:\s*['"](POST|PUT|PATCH|DELETE)/i);
    expect(src).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/);
    expect(src).not.toMatch(/anthropic|openai|api\.groq|generativelanguage/i);
  });
});
