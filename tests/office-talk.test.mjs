import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
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

describe('office talk: brief produksi ke inbox', () => {
  const inbox = mkdtempSync(path.join(os.tmpdir(), 'aao-in-'));
  const mk3 = () => createTalk({ base, port: 3190, inboxRoot: inbox });
  it('menulis brief ke inbox sebagai .md dengan nama aman', async () => {
    const r = (await call(mk3(), 'POST', '/api/talk/brief', { name: '../../evil name.md', text: '# Brief isi' })).res;
    expect(r.code).toBe(200);
    expect(r.body.file).toMatch(/^[0-9]+-evil-name[.]md$/);
    expect(readFileSync(path.join(inbox, r.body.file), 'utf8')).toContain('isi');
  });
  it('menolak origin asing, kosong, dan terlalu besar', async () => {
    const h = mk3();
    expect((await call(h, 'POST', '/api/talk/brief', { text: 'x' }, 'evil.com')).res.code).toBe(403);
    expect((await call(h, 'POST', '/api/talk/brief', { text: '  ' })).res.code).toBe(400);
    expect((await call(h, 'POST', '/api/talk/brief', { text: 'x'.repeat(150_001) })).res.code).toBe(400);
  });
  it('tanpa inbox terkonfigurasi -> 503', async () => {
    expect((await call(createTalk({ base, port: 3190 }), 'POST', '/api/talk/brief', { text: 'x' })).res.code).toBe(503);
  });
});

// ── balasan owner untuk rencana ditahan lewat chat (tanpa membangkitkan Manager) + kotak keluar
import { mkdtempSync as mkd, mkdirSync as mkdirS, writeFileSync as wf, readdirSync as rd, readFileSync as rf } from 'node:fs';
import { tmpdir as td } from 'node:os';
import pathMod from 'node:path';
import { createTalk as mkTalk } from '../apps/office-view/talk.mjs';
import { appendOutbox as appOut } from '../scripts/manager-outbox.mjs';

describe('chat: rencana Manager yang ditahan', () => {
  const setup = (planOver = {}, orderOver = {}) => {
    const root = mkd(pathMod.join(td(), 'aao-chat-'));
    const outputRoot = pathMod.join(root, 'agent'); mkdirS(pathMod.join(outputRoot, 'orders'), { recursive: true });
    const stateFile = pathMod.join(root, 'state.json');
    wf(stateFile, JSON.stringify({ job: null, history: [], pending: [{ identifier: 'EDU-61', hold: true, ready: true, readyMs: 5, ...planOver }] }));
    wf(pathMod.join(outputRoot, 'orders', 'EDU-61.json'), JSON.stringify({ title: 't', ownerQuestions: ['Produk OpenAI atau Google?'], stages: {}, ...orderOver }));
    const talk = mkTalk({ base: 'http://127.0.0.1:1', port: 3190, outputRoot, inboxRoot: pathMod.join(root, 'inbox'), stateFile });
    const call = async (path, body) => {
      const chunks = []; const req = { headers: { host: '127.0.0.1:3190' }, method: body ? 'POST' : 'GET', async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(JSON.stringify(body)); } };
      let out = null; const json = (res, code, b) => { out = { code, b }; };
      await talk(req, {}, new URL('http://x' + path), json);
      return out;
    };
    return { outputRoot, call, holds: () => { try { return rd(pathMod.join(outputRoot, 'holds')); } catch { return []; } }, read: (f) => rf(pathMod.join(outputRoot, 'holds', f), 'utf8') };
  };

  it('"setuju" melepas rencana lewat berkas, tanpa membuat issue/Manager', async () => {
    const t = setup();
    const r = await t.call('/api/talk', { text: 'setuju' });
    expect(r.code).toBe(200); expect(r.b.kind).toBe('plan'); expect(r.b.answer).toMatch(/EDU-61 disetujui/);
    expect(t.holds()).toEqual(['EDU-61.release']);
  });
  it('"setuju, ..." menulis catatan lebih dulu lalu melepas; "batal" menulis berkas batal', async () => {
    const t = setup();
    const r = await t.call('/api/talk', { text: 'setuju, maksudnya produk resmi OpenAI' });
    expect(r.b.answer).toMatch(/dengan catatan Anda/);
    const files = t.holds(); expect(files.some((f) => f.endsWith('.note'))).toBe(true); expect(files).toContain('EDU-61.release');
    expect(JSON.parse(t.read(files.find((f) => f.endsWith('.note')))).text).toBe('maksudnya produk resmi OpenAI');
    const t2 = setup(); const c = await t2.call('/api/talk', { text: 'batal' });
    expect(c.b.answer).toMatch(/dibatalkan/); expect(t2.holds()).toEqual(['EDU-61.cancel']);
  });
  it('jawaban bebas atas pertanyaan Manager dicatat sebagai catatan; pertanyaan/umum tidak dicegat', async () => {
    const t = setup();
    const r = await t.call('/api/talk', { text: 'produk resmi OpenAI' });
    expect(r.b.kind).toBe('plan'); expect(r.b.answer).toMatch(/dicatat ke rencana EDU-61/);
    expect(t.holds().every((f) => f.endsWith('.note'))).toBe(true);
  });
  it('tanpa rencana ditahan, pesan "setuju" tidak dicegat sebagai keputusan rencana', async () => {
    const t = setup({ hold: false });
    // jatuh ke jalur chat biasa (Paperclip tidak terjangkau di tes => galat 502), bukan kind:plan
    const r = await t.call('/api/talk', { text: 'setuju' });
    expect(r.b.kind).not.toBe('plan'); expect(t.holds()).toEqual([]);
  });
  it('endpoint kotak keluar: pesan baru muncul, after menyaring yang sudah dilihat', async () => {
    const t = setup();
    appOut(pathMod.join(t.outputRoot, 'chat'), { kind: 'plan', identifier: 'EDU-61', text: 'rencana A', from: 'Manager (Claude)' }, 1000);
    appOut(pathMod.join(t.outputRoot, 'chat'), { kind: 'plan', identifier: 'EDU-63', text: 'rencana B' }, 2000);
    const all = await t.call('/api/talk/outbox?after=0');
    expect(all.b.messages.map((m) => m.text)).toEqual(['rencana A', 'rencana B']); expect(all.b.messages[0].from).toBe('Manager (Claude)');
    const after = await t.call('/api/talk/outbox?after=1');
    expect(after.b.messages.map((m) => m.text)).toEqual(['rencana B']);
  });
});
