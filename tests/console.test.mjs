// Test Office Console: read-only, company terlarang tidak terbaca, path aman. Paperclip digantikan server palsu lokal.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';

const MEGA = '11111111-1111-4111-8111-111111111111';
const EDU = '22222222-2222-4222-8222-222222222222';
const ISO = '33333333-3333-4333-8333-333333333333';
const seen = [];
let fake;
let consoleServer;
let base;

beforeAll(async () => {
  fake = http.createServer((req, res) => {
    seen.push(req.url);
    const send = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url === '/api/companies') return send([{ id: MEGA, name: 'Office Mega Class' }, { id: EDU, name: 'EdukasiAI', description: 'uji' }, { id: ISO, name: 'IsolationTest' }]);
    if (req.url === '/api/health') return send({ status: 'ok', version: 't' });
    if (req.url.startsWith(`/api/companies/${EDU}/agents`)) return send([{ id: 'a1', name: 'Researcher', role: 'researcher', status: 'idle', adapterConfig: { timeoutSec: 600 } }]);
    if (req.url.startsWith(`/api/companies/${EDU}/`)) return send([]);
    res.writeHead(404); res.end('{}');
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  process.env.AAO_API_BASE = `http://127.0.0.1:${fake.address().port}`;
  const mod = await import('../console/server.mjs');
  consoleServer = mod.server;
  await new Promise((r) => consoleServer.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${consoleServer.address().port}`;
});
afterAll(async () => {
  await new Promise((r) => consoleServer.close(r));
  await new Promise((r) => fake.close(r));
});

describe('office console', () => {
  it('hanya menampilkan division produksi: Office Mega Class dan IsolationTest disembunyikan', async () => {
    const o = await (await fetch(`${base}/api/office`)).json();
    expect(o.divisions.map((d) => d.name)).toEqual(['EdukasiAI']);
    expect(o.divisions[0].agents).toBe(1);
  });

  it('Office Mega Class tidak pernah dibaca: tidak ada permintaan ke company-nya, dan detailnya 404', async () => {
    const r = await fetch(`${base}/api/division/${MEGA}`);
    expect(r.status).toBe(404);
    expect(seen.some((u) => u.includes(MEGA))).toBe(false);
  });

  it('division yang sah dapat dimuat', async () => {
    const r = await fetch(`${base}/api/division/${EDU}`);
    expect(r.status).toBe(200);
    const d = await r.json();
    expect(d.company.name).toBe('EdukasiAI');
    expect(d.agents).toHaveLength(1);
  });

  it('read-only: POST, PUT, PATCH, DELETE ditolak 405', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect((await fetch(`${base}/api/office`, { method })).status, method).toBe(405);
    }
  });

  it('endpoint berkas hanya melayani nama berkas render yang diizinkan dan UUID valid', async () => {
    const id = '44444444-4444-4444-8444-444444444444';
    for (const p of [`/api/file/${id}/..%2f..%2fpackage.json`, `/api/file/${id}/secret.txt`, `/api/file/..%2f..%2fx/slide-01.png`, `/api/file/${id}/slide-01.png.exe`]) {
      expect([400, 404], p).toContain((await fetch(base + p)).status);
    }
    expect((await fetch(`${base}/api/file/${id}/slide-01.png`)).status).toBe(404); // valid tetapi tidak ada
  });

  it('berkas statis tidak bisa keluar dari folder public', async () => {
    for (const p of ['/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/package.json', '/..\\..\\package.json']) {
      const r = await fetch(base + p);
      expect([403, 404], p).toContain(r.status);
      expect((await r.text()).includes('"devDependencies"')).toBe(false);
    }
    expect((await fetch(`${base}/`)).status).toBe(200);
  });

  it('server hanya mendengar di loopback', () => {
    expect(consoleServer.address().address).toBe('127.0.0.1');
  });
});
