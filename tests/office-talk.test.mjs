import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTalk } from '../apps/office-view/talk.mjs';

let mock, base, calls = [], tclock = 1_000_000;
beforeAll(async () => {
  mock = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
    calls.push({ method: req.method, url: req.url, body });
    const out = (j) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (req.url === '/api/companies') return out([{ id: 'c1', name: 'Office Mega Class' }, { id: 'c2', name: 'EdukasiAI' }]);
    if (req.url === '/api/companies/c2/agents') return out([{ id: 'a1', name: 'Researcher' }, { id: 'a2', name: 'Manager' }]);
    if (req.url === '/api/companies/c2/projects') return out([{ id: 'p1' }]);
    if (req.url === '/api/companies/c2/issues' && req.method === 'POST') return out({ id: 'i1', identifier: 'EDU-1' });
    if (req.url === '/api/issues/i1/comments' && req.method === 'POST') return out({ id: 'cm1' });
    if (req.url === '/api/issues/i1/comments') return out([{ authorType: 'agent', authorAgentId: 'a2', body: 'Siap', createdAt: 't3' }, { authorType: 'system', body: 'Paperclip needs a disposition', createdAt: 't2' }, { authorType: 'user', body: 'Halo', createdAt: 't1' }]);
    if (req.url === '/api/issues/i1') return out({ identifier: 'EDU-1', status: 'todo' });
    res.writeHead(404); res.end('{}');
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${mock.address().port}`;
});
afterAll(() => mock.close());

const mk = () => createTalk({ base, port: 3190, now: () => (tclock += 10_000) });
const fakeRes = () => { const r = { code: 0, body: null }; return r; };
const json = (res, code, body) => { res.code = code; res.body = body; };
const req = (method, host = '127.0.0.1:3190', origin, payload) => {
  const r = http.IncomingMessage.prototype;
  const stream = (async function* () { if (payload !== undefined) yield Buffer.from(JSON.stringify(payload)); })();
  stream.method = method; stream.headers = { host, ...(origin ? { origin } : {}) };
  return stream;
};
const call = async (h, method, url, payload, host, origin) => { const res = fakeRes(); const handled = await h(req(method, host, origin, payload), res, new URL(url, 'http://x'), json); return { handled, res }; };

describe('office talk', () => {
  it('ignores non-talk paths', async () => { expect((await call(mk(), 'GET', '/api/status')).handled).toBe(false); });
  it('creates an issue assigned to the Manager of EdukasiAI only, UTF-8 safe', async () => {
    calls = []; const h = mk();
    const { res } = await call(h, 'POST', '/api/talk', { text: 'Buat brief gaya tegas — “angka besar”' });
    expect(res.code).toBe(200); expect(res.body).toMatchObject({ issueId: 'i1', kind: 'issue' });
    const post = calls.find((c) => c.url === '/api/companies/c2/issues');
    expect(post.body).toMatchObject({ assigneeAgentId: 'a2', projectId: 'p1' });
    expect(post.body.description).toContain('“angka besar”');
    expect(calls.some((c) => c.url.includes('/c1/'))).toBe(false);
  });
  it('rejects foreign host/origin, empty, and oversized text', async () => {
    const h = mk();
    expect((await call(h, 'POST', '/api/talk', { text: 'x' }, 'evil.com')).res.code).toBe(403);
    expect((await call(h, 'POST', '/api/talk', { text: 'x' }, '127.0.0.1:3190', 'http://evil.com')).res.code).toBe(403);
    expect((await call(h, 'POST', '/api/talk', { text: '   ' })).res.code).toBe(400);
    expect((await call(h, 'POST', '/api/talk', { text: 'x'.repeat(4001) })).res.code).toBe(400);
  });
  it('rate limits rapid messages', async () => {
    const h = createTalk({ base, port: 3190, now: () => 5000 });
    expect((await call(h, 'POST', '/api/talk', { text: 'a' })).res.code).toBe(200);
    expect((await call(h, 'POST', '/api/talk', { text: 'b' })).res.code).toBe(429);
  });
  it('follow-up goes as comment only to issues made here, thread is oldest-first', async () => {
    const h = mk();
    expect((await call(h, 'POST', '/api/talk', { text: 'b', issueId: 'zzz' })).res.code).toBe(404);
    await call(h, 'POST', '/api/talk', { text: 'awal' });
    expect((await call(h, 'POST', '/api/talk', { text: 'lanjut', issueId: 'i1' })).res.body).toMatchObject({ kind: 'comment' });
    const t = await call(h, 'GET', '/api/talk/thread?issue=i1');
    expect(t.res.body.comments.map((c) => c.from)).toEqual(['Owner', 'Sistem', 'Manager']);
    expect(t.res.body.comments.map((c) => c.kind)).toEqual(['owner', 'system', 'agent']);
    expect((await call(h, 'GET', '/api/talk/thread?issue=other')).res.code).toBe(404);
  });
});

describe('office talk: hasil kerja (read-only, terkurung di folder output)', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'aao-out-'));
  mkdirSync(path.join(root, 'briefs'));
  writeFileSync(path.join(root, 'briefs', 'EDU-1.md'), '# Brief isi');
  writeFileSync(path.join(root, 'rahasia.exe'), 'x');
  const mk2 = () => createTalk({ base, port: 3190, outputRoot: root });
  it('mendaftar hanya .md/.json/.txt, termasuk subfolder', async () => {
    const r = (await call(mk2(), 'GET', '/api/talk/outputs')).res.body.files.map((f) => f.path);
    expect(r).toEqual(['briefs/EDU-1.md']);
  });
  it('membaca file sah, menolak traversal dan ekstensi lain', async () => {
    const h = mk2();
    expect((await call(h, 'GET', '/api/talk/file?path=briefs/EDU-1.md')).res.body.body).toContain('isi');
    expect((await call(h, 'GET', '/api/talk/file?path=../etc/passwd.txt')).res.code).toBe(403);
    expect((await call(h, 'GET', '/api/talk/file?path=rahasia.exe')).res.code).toBe(403);
    expect((await call(h, 'GET', '/api/talk/file?path=briefs/tidak-ada.md')).res.code).toBe(404);
  });
});
