import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { scrubString, scrubDeep, shortId } from '../scripts/mirror/scrub.mjs';
import { findImagePaths, mergeEvents, intervals, prodDue, memoryOk, hashOf } from '../scripts/mirror/plan.mjs';
import { createPublisher } from '../scripts/mirror-publisher.mjs';
import { inSync } from '../scripts/build-monitor-site.mjs';
import { createDevServer } from '../vercel-monitor/dev-server.mjs';

describe('penyaring data keluar', () => {
  it('jalur lokal, rahasia, surel dibuang; UUID dipetakan stabil; kode konten dan jalur relatif tetap', () => {
    const t = scrubString('lihat D:\\AI-Memory\\AI-Agent-Office\\workspace\\x.json dan C:/Users/Farrel/a.png, token=abcd1234efgh, mail a@b.co, EDU-97, runs/EDU-97/render/slide-01.png');
    expect(t).not.toMatch(/AI-Memory|Farrel|abcd1234|a@b\.co/);
    expect(t).toMatch(/EDU-97/); expect(t).toMatch(/runs\/EDU-97\/render\/slide-01\.png/);
    const u = '9461f2e1-1ba6-4b23-b030-82558db43013';
    expect(scrubString(u)).toBe(shortId(u)); expect(shortId(u)).toBe('id-9461f2e1');
    expect(scrubString('Authorization: ' + ['Bear', 'er '].join('') + 'abcdefghij'.repeat(3))).toMatch(/\[disembunyikan\]/);
    expect(scrubString('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
  });
  it('scrubDeep: rekursif pada objek dan larik, nilai non-teks dan kunci tidak berubah', () => {
    const o = scrubDeep({ id: '9461f2e1-1ba6-4b23-b030-82558db43013', n: 3, ok: true, list: ['D:\\x\\y.txt', { p: '/Users/Farrel/z' }] });
    expect(o).toEqual({ id: 'id-9461f2e1', n: 3, ok: true, list: ['[jalur-lokal]', { p: '[jalur-lokal]' }] });
  });
});

describe('perencana publisher', () => {
  it('findImagePaths menemukan gambar render di dokumen bersarang, tanpa duplikat dan tanpa bukti posting', () => {
    const p = findImagePaths({ items: [{ cover: 'runs/EDU-97/revision-1/render/slide-01.png' }, { cover: 'runs/EDU-97/revision-1/render/slide-01.png' }] }, { slides: [{ image: 'runs/EDU-27/render/slide-02.png' }], x: 'autopost/evidence/EDU-97/galat.png' });
    expect(p.sort()).toEqual(['runs/EDU-27/render/slide-02.png', 'runs/EDU-97/revision-1/render/slide-01.png']);
  });
  it('mergeEvents: menambah tanpa duplikat, urut seq, epoch baru mengganti ring, dibatasi', () => {
    let r = mergeEvents(null, { epoch: 1, seq: 2, connected: true, events: [{ seq: 1 }, { seq: 2 }] });
    r = mergeEvents(r, { epoch: 1, seq: 4, connected: true, events: [{ seq: 2 }, { seq: 3 }, { seq: 4 }] });
    expect(r.events.map((e) => e.seq)).toEqual([1, 2, 3, 4]); expect(r.seq).toBe(4);
    expect(mergeEvents(r, { epoch: 2, seq: 1, connected: true, events: [{ seq: 1 }] }).events).toEqual([{ seq: 1 }]);
    expect(mergeEvents(null, { epoch: 1, seq: 9, events: Array.from({ length: 400 }, (_, i) => ({ seq: i + 1 })) }, 300).events).toHaveLength(300);
  });
  it('jadwal melambat saat tidak ada agen bekerja (hemat beban Paperclip)', () => {
    const a = intervals({ anyWorking: true }); const i = intervals({ anyWorking: false });
    for (const k of ['events', 'board', 'agent', 'approvals', 'prodActive']) expect(i[k], k).toBeGreaterThan(a[k]);
    expect(a.agent).toBeGreaterThanOrEqual(60_000); // Paperclip dibaca paling cepat tiap menit
  });
  it('prodDue: konten baru/berubah/aktif dibaca; yang tenang dan tak berubah tidak', () => {
    const iv = intervals({ anyWorking: true }); const now = 10_000_000;
    const items = [{ prod: 'EDU-2', createdAt: '2026-10-17', status: { key: 'berjalan' }, slides: 0 }, { prod: 'EDU-1', createdAt: '2026-10-16', status: { key: 'disetujui' }, slides: 7 }];
    const same = (it) => hashOf({ s: it.status, sl: it.slides, c: it.cover, t: it.title, r: it.revision });
    expect(prodDue({ items, lastRead: {}, itemHash: {}, nowMs: now, iv })).toEqual(['EDU-2', 'EDU-1']);
    const lastRead = { 'EDU-2': now - 10_000, 'EDU-1': now - 10_000 }; const itemHash = { 'EDU-2': same(items[0]), 'EDU-1': same(items[1]) };
    expect(prodDue({ items, lastRead, itemHash, nowMs: now, iv })).toEqual([]);
    expect(prodDue({ items, lastRead: { ...lastRead, 'EDU-2': now - 61_000 }, itemHash, nowMs: now, iv })).toEqual(['EDU-2']); // aktif => 60 dtk
    expect(prodDue({ items, lastRead, itemHash: { ...itemHash, 'EDU-1': 'lain' }, nowMs: now, iv })).toEqual(['EDU-1']);
    expect(prodDue({ items: Array.from({ length: 9 }, (_, i) => ({ prod: `EDU-${i}`, createdAt: `2026-10-${10 + i}` })), lastRead: {}, itemHash: {}, nowMs: now, iv, maxProd: 3 })).toHaveLength(3);
  });
  it('memoryOk: berhenti bila RAM bebas < 500 MB', () => { expect(memoryOk(400 * 1024 * 1024)).toBe(false); expect(memoryOk(2 * 1024 ** 3)).toBe(true); });
});

// ───────── fungsi Vercel (penyimpanan folder) lewat peniru lokal ─────────
const SECRETS = { MIRROR_INGEST_SECRET: 'ingest-uji', MIRROR_REVIEW_KEY: 'kunci-uji-0123456789', MIRROR_SESSION_SECRET: 's'.repeat(48) };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
let srv; let base; let dir; let cookie;
const call = async (p, init = {}) => fetch(base + p, { redirect: 'manual', ...init, headers: { ...(init.headers ?? {}), ...(cookie && !init.noCookie ? { cookie } : {}) } });
const ingest = (key, body, secret = SECRETS.MIRROR_INGEST_SECRET) => call(`/api/ingest?key=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'x-ingest-secret': secret }, body, noCookie: true });

describe('monitor Vercel (fungsi api/*)', () => {
  beforeEach(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'mirror-'));
    Object.assign(process.env, SECRETS, { MIRROR_FS_DIR: dir });
    srv = createDevServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${srv.address().port}`; cookie = null;
    return () => { srv.close(); rmSync(dir, { recursive: true, force: true }); delete process.env.MIRROR_FS_DIR; };
  });
  const login = async () => { const r = await call(`/review?key=${SECRETS.MIRROR_REVIEW_KEY}`, { noCookie: true }); cookie = String(r.headers.get('set-cookie')).split(';')[0]; return r; };

  it('tanpa cookie semua ditolak 401; tautan benar memberi cookie HttpOnly; kunci salah 403', async () => {
    for (const p of ['/', '/api/snapshot', '/api/inspect/board', '/office.js']) expect((await call(p)).status, p).toBe(401);
    expect((await call('/review?key=salah')).status).toBe(403);
    const r = await login(); expect(r.status).toBe(302); expect(r.headers.get('set-cookie')).toMatch(/HttpOnly/);
    expect((await call('/')).status).toBe(200);
  });
  it('ingest: tanpa/salah rahasia 401; kunci jahat 400; JSON rusak 400; PNG palsu 400; sah 200', async () => {
    expect((await ingest('doc/x', '{}', 'salah')).status).toBe(401);
    expect((await call('/api/ingest?key=doc/x', { method: 'POST', body: '{}', noCookie: true })).status).toBe(401);
    for (const k of ['../etc/passwd', 'doc/../x', '/abs', 'a//b', '', 'doc/']) expect((await ingest(k, '{}')).status, k).toBe(400);
    expect((await ingest('doc/x', '{rusak')).status).toBe(400);
    expect((await ingest('img/runs/EDU-1/render/a.png', Buffer.from('bukan png'))).status).toBe(400);
    expect((await ingest('doc/x', '{"a":1}')).status).toBe(200);
    expect((await ingest('img/runs/EDU-1/render/a.png', PNG)).status).toBe(200);
  });
  it('ingest terlalu besar ditolak (413)', async () => {
    expect((await ingest('doc/besar', Buffer.alloc(4_100_000, 97))).status).toBe(413);
  });
  it('data: events disaring since, board dipotong limit, produksi/agen/gambar disajikan; rute internal 404/403; non-GET 405', async () => {
    await ingest('doc/events', JSON.stringify({ epoch: 3, seq: 5, connected: true, events: [{ seq: 1 }, { seq: 3 }, { seq: 5 }] }));
    await ingest('doc/board', JSON.stringify({ items: [{ prod: 'EDU-3' }, { prod: 'EDU-2' }, { prod: 'EDU-1' }] }));
    await ingest('doc/prod/EDU-3', JSON.stringify({ title: 'T3' })); await ingest('doc/prod/EDU-3/r1', JSON.stringify({ title: 'T3r1' }));
    await ingest('doc/agent/qa', JSON.stringify({ agent: { name: 'QA' } }));
    await ingest('doc/meta', JSON.stringify({ publishedAt: Date.now() }));
    await ingest('img/runs/EDU-3/render/slide-01.png', PNG);
    await login();
    const j = async (p) => (await call(p)).json();
    expect((await j('/api/events?since=2')).events.map((e) => e.seq)).toEqual([3, 5]);
    expect((await j('/api/inspect/board?limit=2')).items).toHaveLength(2);
    expect((await j('/api/inspect/production?prod=EDU-3')).title).toBe('T3');
    expect((await j('/api/inspect/production?prod=EDU-3&rev=1')).title).toBe('T3r1');
    expect((await j('/api/inspect/agent?name=QA')).agent.name).toBe('QA');
    expect(await j('/api/talk/info')).toEqual({ enabled: false }); expect(await j('/api/owner/info')).toEqual({ enabled: false });
    expect(await j('/api/access/whoami')).toMatchObject({ role: 'review', readOnly: true, mirror: true });
    const img = await call('/api/inspect/image?path=runs/EDU-3/render/slide-01.png'); expect(img.status).toBe(200); expect(img.headers.get('content-type')).toBe('image/png');
    expect((await call('/api/inspect/image?path=autopost/evidence/x.png')).status).toBe(403);
    expect((await call('/api/inspect/production?prod=../x')).status).toBe(400);
    expect((await call('/api/inspect/agent?name=admin')).status).toBe(400);
    expect((await call('/api/inspect/file?path=x')).status).toBe(404); expect((await call('/api/talk/thread?issue=1')).status).toBe(404);
    expect((await call('/api/snapshot')).status).toBe(404); // belum dikirim laptop
    for (const m of ['POST', 'PUT', 'DELETE']) expect((await call('/api/talk', { method: m, body: '{}' })).status, m).toBe(405);
  });
});

describe('publisher (laptop)', () => {
  const mkFetch = (log) => async (url, init = {}) => {
    const u = String(url); log.push({ url: u, method: init.method ?? 'GET' });
    const json = (b) => ({ ok: true, status: 200, json: async () => b, text: async () => JSON.stringify(b), arrayBuffer: async () => Buffer.from(JSON.stringify(b)) });
    if (u.startsWith('http://127.0.0.1:3190')) {
      if (u.includes('/api/snapshot')) return json({ epoch: 1, seq: 2, connected: true, events: [{ type: 'agent.state', agentId: '9461f2e1-1ba6-4b23-b030-82558db43013', state: 'working', seq: 0 }] });
      if (u.includes('/api/events')) return json({ epoch: 1, seq: 2, connected: true, events: [{ seq: 1, type: 'comment', agentId: 'a', issue: { id: 'u', identifier: 'EDU-1', title: 'T' }, excerpt: 'RENCANA INTERNAL D:\\x\\y' }] });
      if (u.includes('/api/inspect/board')) return json({ items: [{ prod: 'EDU-1', createdAt: '2026-10-17', status: { key: 'berjalan' }, cover: 'runs/EDU-1/render/slide-01.png', slides: 1 }] });
      if (u.includes('/api/inspect/production')) return json({ title: 'T', versions: [{ rev: 0 }, { rev: 1 }] });
      if (u.includes('/api/inspect/image')) return { ok: true, status: 200, arrayBuffer: async () => PNG };
      return json({ ok: true, path: 'D:\\AI-Memory\\x' });
    }
    return { ok: true, status: 200, text: async () => '{}' };
  };
  const env = () => ({ MIRROR_URL: 'https://monitor.example.app', MIRROR_INGEST_SECRET: 'rahasia' });

  it('hanya GET ke Office View lokal (tidak pernah menulis ke agen/Paperclip); unggahan hanya ke /api/ingest dengan rahasia', async () => {
    const log = []; const pub = createPublisher({ persist: false, fetchImpl: mkFetch(log), env, gapMs: 0, readImage: () => PNG });
    const r = await pub.cycle();
    expect(r.failed).toBe(0); expect(r.uploaded).toBeGreaterThan(5);
    const local = log.filter((l) => l.url.startsWith('http://127.0.0.1:3190')); const remote = log.filter((l) => !l.url.startsWith('http://127.0.0.1:3190'));
    expect(local.every((l) => l.method === 'GET')).toBe(true);
    expect(remote.every((l) => l.method === 'POST' && l.url.startsWith('https://monitor.example.app/api/ingest?key='))).toBe(true);
    expect(remote.some((l) => l.url.includes('img%2Fruns%2FEDU-1%2Frender%2Fslide-01.png'))).toBe(true);
  });
  it('isi yang diunggah sudah bersih: tanpa kutipan komentar, jalur lokal, dan UUID', async () => {
    const bodies = []; const f = mkFetch([]);
    const fetchImpl = async (url, init) => { if (init?.body && !Buffer.from(init.body).subarray(0, 4).equals(PNG.subarray(0, 4))) bodies.push(Buffer.from(init.body).toString('utf8')); return f(url, init); };
    await createPublisher({ persist: false, fetchImpl, env, gapMs: 0, readImage: () => PNG }).cycle();
    const all = bodies.join('\n');
    expect(all).not.toMatch(/RENCANA INTERNAL|AI-Memory|D:\\\\|9461f2e1-1ba6-4b23-b030-82558db43013/);
    expect(all).toMatch(/id-9461f2e1/);
  });
  it('siklus kedua tanpa perubahan tidak mengunggah ulang (hash sama); dry-run tidak memanggil jaringan luar', async () => {
    const log = []; const pub = createPublisher({ persist: false, fetchImpl: mkFetch(log), env, gapMs: 0, readImage: () => PNG });
    await pub.cycle(); const n1 = log.filter((l) => l.method === 'POST').length;
    Object.keys(pub.state.last).forEach((k) => { pub.state.last[k] = 0; }); pub.state.last.prod = {};
    await pub.cycle(); const n2 = log.filter((l) => l.method === 'POST').length;
    expect(n2 - n1).toBeLessThanOrEqual(2); // hanya meta (cap waktu) yang boleh berubah
    const log2 = []; await createPublisher({ persist: false, fetchImpl: mkFetch(log2), env, gapMs: 0, dryRun: true, readImage: () => PNG }).cycle();
    expect(log2.some((l) => l.method === 'POST')).toBe(false);
  });
  it('RAM menipis => siklus dilewati tanpa permintaan apa pun; gagal unggah dicatat, tidak melempar', async () => {
    const log = []; const r = await createPublisher({ persist: false, fetchImpl: mkFetch(log), env, freemem: () => 100 * 1024 * 1024 }).cycle();
    expect(r.skipped).toBe('ram'); expect(log).toHaveLength(0);
    const bad = async (url) => (String(url).startsWith('http://127.0.0.1:3190') ? mkFetch([])(url) : { ok: false, status: 503, text: async () => 'x' });
    const r2 = await createPublisher({ persist: false, fetchImpl: bad, env, gapMs: 0, readImage: () => PNG }).cycle();
    expect(r2.failed).toBeGreaterThan(0);
  });
});

describe('salinan frontend', () => {
  it('vercel-monitor/public sinkron dengan apps/office-view/public (jalankan scripts/build-monitor-site.mjs bila gagal)', () => { expect(inSync()).toBe(true); });
});
void http;
