import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createInspector, safeJoin, productionOf, commentKind } from '../apps/office-view/inspect.mjs';
import { activityTimeline } from '../apps/office-view/status.mjs';

const TEXT = new Set(['.json', '.md', '.txt']);
const IMG = new Set(['.png']);

describe('safeJoin / productionOf / commentKind', () => {
  it('path terkurung di root, ekstensi dibatasi, input aneh ditolak', () => {
    const root = path.resolve('/tmp/aao-root');
    expect(safeJoin(root, 'runs/EDU-1/a.json', TEXT)).toBe(path.join(root, 'runs', 'EDU-1', 'a.json'));
    for (const bad of ['../x.json', 'runs/../../x.json', '/etc/passwd.txt', 'runs/a.exe', '', null, undefined, 'a\0.json']) expect(safeJoin(root, bad, TEXT), String(bad)).toBeNull();
    expect(safeJoin(root, 'runs/x.png', TEXT)).toBeNull(); expect(safeJoin(root, 'runs/x.png', IMG)).not.toBeNull();
  });
  it('productionOf mengenali issue tahap, bukan judul lain', () => {
    expect(productionOf('EDU-27 · Verifier (06:26:47): Produksi: x')).toEqual({ production: 'EDU-27', stage: 'Verifier' });
    expect(productionOf('Produksi: Carousel')).toBeNull(); expect(productionOf(null)).toBeNull();
  });
  it('commentKind: sistem, agen, orkestrator, owner', () => {
    const names = new Map([['a1', 'QA']]);
    expect(commentKind({ authorType: 'system', body: 'x' }, names)).toEqual({ from: 'Sistem', kind: 'system' });
    expect(commentKind({ authorAgentId: 'a1', body: 'x' }, names)).toEqual({ from: 'QA', kind: 'agent' });
    expect(commentKind({ body: '[Orkestrator] ok' }, names)).toEqual({ from: 'Orkestrator', kind: 'system' });
    expect(commentKind({ body: 'halo' }, names)).toEqual({ from: 'Owner', kind: 'owner' });
  });
});

describe('activityTimeline', () => {
  const ev = (ts, part, type = 'tool_use') => JSON.stringify({ ts, stream: 'stdout', chunk: JSON.stringify({ type, part }) });
  it('urut kronologis, dibatasi limit, teks dan alat dikenali, sampah diabaikan', () => {
    const log = [ev('2026-10-09T08:00:01Z', { type: 'tool', tool: 'read', state: { status: 'completed', input: { filePath: 'a.json' } } }), 'bukan json', ev('2026-10-09T08:00:02Z', { type: 'text', text: 'Selesai memeriksa' }, 'text'), ev('2026-10-09T08:00:03Z', { type: 'tool', tool: 'bash', state: { input: { command: 'dir x' } } })].join('\n');
    const t = activityTimeline(log, 2);
    expect(t.map((e) => e.tool)).toEqual(['jawaban', 'bash']);
    expect(activityTimeline(log, 10)[0]).toMatchObject({ tool: 'read', label: 'a.json', status: 'completed' });
    expect(activityTimeline('', 5)).toEqual([]);
  });
});

describe('endpoint inspeksi (Paperclip tiruan)', () => {
  let mock; let base; let root; let calls = [];
  const log = [JSON.stringify({ ts: '2026-10-09T08:20:50Z', chunk: JSON.stringify({ type: 'tool_use', part: { type: 'tool', tool: 'read', state: { input: { filePath: 'research-raw.json' } } } }) })].join('\n');
  beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'aao-insp-'));
    mkdirSync(path.join(root, 'runs', 'EDU-9', 'render'), { recursive: true });
    writeFileSync(path.join(root, 'runs', 'EDU-9', 'qa-result.json'), '{"passed":true}');
    writeFileSync(path.join(root, 'runs', 'EDU-9', 'render', 'contact-sheet.png'), Buffer.from([137, 80, 78, 71]));
    writeFileSync(path.join(root, 'rahasia.txt'), 'x');
    mock = http.createServer((req, res) => {
      calls.push(`${req.method} ${req.url}`);
      const out = (j) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
      const u = req.url;
      if (u === '/api/companies') return out([{ id: 'c1', name: 'EdukasiAI' }]);
      if (u === '/api/companies/c1/agents') return out([{ id: 'a1', name: 'QA', role: 'qa', title: 'QA', status: 'running', adapterType: 'opencode_local', adapterConfig: { model: 'm1' } }, { id: 'a2', name: 'Manager', role: 'pm', status: 'idle', adapterType: 'x', adapterConfig: {} }]);
      if (u.startsWith('/api/companies/c1/heartbeat-runs')) return out([{ id: 'r1', agentId: 'a1', status: 'running', startedAt: '2026-10-09T08:20:00Z' }, { id: 'r0', agentId: 'a1', status: 'failed', startedAt: '2026-10-09T07:00:00Z', finishedAt: '2026-10-09T07:01:00Z', error: 'boom' }]);
      if (u === '/api/heartbeat-runs/r1/log') return out({ content: log });
      if (u === '/api/companies/c1/issues') return out([{ id: 'i1', identifier: 'EDU-42', title: 'EDU-9 · QA (08:14:54): Produksi: x', status: 'in_review', assigneeAgentId: 'a1', updatedAt: '2026-10-09T08:45:00Z' }, { id: 'i2', identifier: 'EDU-50', title: 'Lain', status: 'todo', assigneeAgentId: null }]);
      if (u === '/api/issues/i1') return out({ id: 'i1', identifier: 'EDU-42', title: 'EDU-9 · QA (08:14:54): Produksi: x', status: 'in_review', description: 'Instruksi QA', assigneeAgentId: 'a1' });
      if (u === '/api/issues/i1/comments') return out([{ authorAgentId: 'a1', body: 'Selesai', createdAt: '2026-10-09T08:46:00Z' }, { body: 'halo owner', createdAt: '2026-10-09T08:10:00Z' }]);
      res.writeHead(404); res.end('{}');
    });
    await new Promise((r) => mock.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${mock.address().port}`;
  });
  afterAll(() => mock.close());

  const call = async (method, url) => {
    const res = { code: 0, body: null, buf: null };
    const h = createInspector({ base, outputRoot: root, now: () => 1_791_533_000_000 });
    const handled = await h({ method }, res, new URL(url, 'http://x'), (r, c, b) => { r.code = c; r.body = b; }, (r, c, type, buf) => { r.code = c; r.buf = buf; r.type = type; });
    return { handled, res };
  };

  it('bukan rute inspeksi diabaikan; metode non-GET ditolak', async () => {
    expect((await call('GET', '/api/status')).handled).toBe(false);
    const r = await call('POST', '/api/inspect/agent?name=QA'); expect(r.res.code).toBe(405);
    expect(calls.every((c) => c.startsWith('GET '))).toBe(true);
  });
  it('agent: status, tugas, jejak aktivitas langsung, riwayat run, komentar milik agen', async () => {
    const { res } = await call('GET', '/api/inspect/agent?name=qa');
    expect(res.code).toBe(200);
    expect(res.body.agent).toMatchObject({ name: 'QA', status: 'running', model: 'm1' });
    expect(res.body.issue).toMatchObject({ identifier: 'EDU-42' });
    expect(res.body.timelineFrom).toMatchObject({ live: true }); expect(res.body.timeline[0]).toMatchObject({ tool: 'read', label: 'research-raw.json' });
    expect(res.body.runs.map((r) => r.status)).toEqual(['running', 'failed']); expect(res.body.runs[1].error).toBe('boom');
    expect(res.body.comments).toHaveLength(1); expect(res.body.comments[0].body).toBe('Selesai');
    expect((await call('GET', '/api/inspect/agent?name=nope')).res.code).toBe(404);
  });
  it('approvals mengelompokkan per produksi dan memberi penanggung jawab', async () => {
    const { res } = await call('GET', '/api/inspect/approvals');
    expect(res.body.items).toEqual([expect.objectContaining({ identifier: 'EDU-42', production: 'EDU-9', stage: 'QA', assignee: 'QA' })]);
  });
  it('issue: deskripsi (input) dan percakapan berlabel', async () => {
    const { res } = await call('GET', '/api/inspect/issue?id=i1');
    expect(res.body).toMatchObject({ identifier: 'EDU-42', description: 'Instruksi QA', production: 'EDU-9' });
    expect(res.body.comments.map((c) => c.kind)).toEqual(['owner', 'agent']); // urut waktu: terlama dulu
  });
  it('files: daftar berkas produksi; id tidak valid ditolak', async () => {
    const { res } = await call('GET', '/api/inspect/files?prod=EDU-9');
    expect(res.body.files.map((f) => f.path)).toEqual(['runs/EDU-9/qa-result.json', 'runs/EDU-9/render/contact-sheet.png']);
    expect((await call('GET', '/api/inspect/files?prod=../x')).res.code).toBe(400);
  });
  it('file/image: hanya di dalam root dan ekstensi yang sah', async () => {
    expect((await call('GET', '/api/inspect/file?path=runs/EDU-9/qa-result.json')).res.body.body).toBe('{"passed":true}');
    expect((await call('GET', '/api/inspect/file?path=../x.json')).res.code).toBe(403);
    expect((await call('GET', '/api/inspect/file?path=runs/EDU-9/render/contact-sheet.png')).res.code).toBe(403);
    const img = await call('GET', '/api/inspect/image?path=runs/EDU-9/render/contact-sheet.png');
    expect(img.res.code).toBe(200); expect(img.res.type).toBe('image/png'); expect(img.res.buf.length).toBe(4);
    expect((await call('GET', '/api/inspect/image?path=../rahasia.txt')).res.code).toBe(403);
    expect((await call('GET', '/api/inspect/file?path=runs/EDU-9/tidak-ada.json')).res.code).toBe(404);
  });
});
