import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { evaluateHealth, backoffMs, crashLoop, shouldRestart, summaryLine, HEARTBEAT_MAX_AGE_MS } from '../scripts/connectivity.mjs';
import { writeHeartbeat, readHeartbeat, isFresh, isConnectionError, acquireLock, releaseLock } from '../scripts/heartbeat.mjs';

const NOW = 1_000_000_000;
const ok = { nowMs: NOW, paperclip: { reachable: true, status: 'ok', version: '2026.1001.0' }, plugin: { ready: true }, agents: { count: 6 }, officeView: { reachable: true, connected: true }, orchestrator: { at: NOW - 5_000, paperclipOk: true }, failover: { at: NOW - 20_000, paperclipOk: true } };
const state = (h, key) => h.components.find((c) => c.key === key).state;

describe('evaluateHealth', () => {
  it('semua terhubung => ok tanpa masalah', () => {
    const h = evaluateHealth(ok);
    expect(h.overall).toBe('ok'); expect(h.problems).toEqual([]); expect(h.components.map((c) => c.key)).toEqual(['paperclip', 'plugin', 'agents', 'office-view', 'orchestrator', 'failover']);
  });
  it('Paperclip mati => putus; komponen yang bergantung ditandai tidak-terhubung (bukan dianggap ok)', () => {
    const h = evaluateHealth({ ...ok, paperclip: { reachable: false } });
    expect(h.overall).toBe('putus'); expect(state(h, 'paperclip')).toBe('mati'); expect(state(h, 'plugin')).toBe('tidak-terhubung'); expect(state(h, 'agents')).toBe('tidak-terhubung');
  });
  it('Paperclip masih memulihkan diri (starting) => mulai, bukan mati', () => {
    expect(state(evaluateHealth({ ...ok, paperclip: { reachable: true, status: 'starting' } }), 'paperclip')).toBe('mulai');
  });
  it('plugin belum siap atau agent kurang => tidak-terhubung dengan keterangan jelas', () => {
    const a = evaluateHealth({ ...ok, plugin: { ready: false } }); expect(state(a, 'plugin')).toBe('tidak-terhubung'); expect(a.problems.join()).toMatch(/approval-gate belum siap/);
    const b = evaluateHealth({ ...ok, agents: { count: 4 } }); expect(b.problems.join()).toMatch(/4 dari 6 agent/);
    expect(state(evaluateHealth({ ...ok, plugin: { ready: null } }), 'plugin')).toBe('ok');
  });
  it('Office View hidup tapi jembatan putus => tidak-terhubung; UI tidak menjawab => mati', () => {
    expect(state(evaluateHealth({ ...ok, officeView: { reachable: true, connected: false } }), 'office-view')).toBe('tidak-terhubung');
    expect(state(evaluateHealth({ ...ok, officeView: { reachable: false, connected: null } }), 'office-view')).toBe('mati');
  });
  it('orkestrator: detak segar+terhubung ok; detak segar tapi paperclipOk=false tidak-terhubung; detak basi macet; tanpa proses mati; baru dinyalakan mulai', () => {
    expect(state(evaluateHealth(ok), 'orchestrator')).toBe('ok');
    expect(state(evaluateHealth({ ...ok, orchestrator: { at: NOW - 1000, paperclipOk: false } }), 'orchestrator')).toBe('tidak-terhubung');
    const stale = evaluateHealth({ ...ok, orchestrator: { at: NOW - HEARTBEAT_MAX_AGE_MS.orchestrator - 1000 }, alive: { orchestrator: true } });
    expect(state(stale, 'orchestrator')).toBe('tidak-terhubung'); expect(stale.problems.join()).toMatch(/macet/);
    expect(state(evaluateHealth({ ...ok, orchestrator: { at: NOW - 999_999 }, alive: { orchestrator: false } }), 'orchestrator')).toBe('mati');
    expect(state(evaluateHealth({ ...ok, failover: null }), 'failover')).toBe('mulai');
  });
});

describe('keputusan pemulihan', () => {
  it('mati => mulai ulang segera; tidak-terhubung => hanya setelah masa tenggang dan bila Paperclip sehat; mulai/ok => tidak', () => {
    expect(shouldRestart({ state: 'mati', nowMs: NOW }).restart).toBe(true);
    expect(shouldRestart({ state: 'tidak-terhubung', sinceMs: NOW - 30_000, nowMs: NOW, paperclipOk: true }).restart).toBe(false);
    expect(shouldRestart({ state: 'tidak-terhubung', sinceMs: NOW - 61_000, nowMs: NOW, paperclipOk: true }).restart).toBe(true);
    expect(shouldRestart({ state: 'tidak-terhubung', sinceMs: NOW - 600_000, nowMs: NOW, paperclipOk: false }).restart).toBe(false); // jangan memaksa saat Paperclip sendiri sakit
    for (const s of ['ok', 'mulai']) expect(shouldRestart({ state: s, sinceMs: 0, nowMs: NOW, paperclipOk: true }).restart).toBe(false);
  });
  it('jeda mulai-ulang eksponensial berbatas dan deteksi lingkaran macet', () => {
    expect([0, 1, 2, 3, 10].map(backoffMs)).toEqual([2000, 4000, 8000, 16000, 60000]);
    expect(crashLoop([NOW - 1000, NOW - 2000, NOW - 3000, NOW - 4000, NOW - 5000], NOW)).toBe(false);
    expect(crashLoop(Array.from({ length: 6 }, (_, i) => NOW - i * 1000), NOW)).toBe(true);
    expect(crashLoop(Array.from({ length: 6 }, (_, i) => NOW - 10 * 60_000 - i), NOW)).toBe(false); // sudah lama
  });
  it('ringkasan satu baris', () => {
    expect(summaryLine({ overall: 'ok', components: [], paused: false })).toBe('Semua terhubung');
    expect(summaryLine({ overall: 'putus', components: [], paused: true })).toBe('Paperclip PUTUS · DIJEDA');
    expect(summaryLine({ overall: 'sebagian', components: [{ label: 'Orkestrator', state: 'mati' }, { label: 'Failover model', state: 'ok' }] })).toBe('Sebagian bermasalah: Orkestrator');
  });
});

describe('heartbeat dan kunci proses', () => {
  const root = () => mkdtempSync(path.join(tmpdir(), 'aao-hb-'));
  it('tulis/baca detak jantung dan penilaian kesegaran', () => {
    const r = root();
    expect(readHeartbeat(r, 'orchestrator')).toBeNull();
    writeHeartbeat(r, 'orchestrator', { ok: true, paperclipOk: true }, 5000);
    expect(readHeartbeat(r, 'orchestrator')).toMatchObject({ name: 'orchestrator', at: 5000, ok: true, paperclipOk: true });
    expect(isFresh({ at: 5000 }, 1000, 5500)).toBe(true); expect(isFresh({ at: 5000 }, 1000, 7000)).toBe(false); expect(isFresh(null, 1000, 0)).toBe(false);
  });
  it('galat koneksi dibedakan dari galat tugas', () => {
    for (const t of ['fetch failed', 'connect ECONNREFUSED 127.0.0.1:3177', 'ETIMEDOUT']) expect(isConnectionError(t), t).toBe(true);
    for (const t of ['schema validation failed', '', null]) expect(isConnectionError(t), String(t)).toBe(false);
  });
  it('kunci proses tunggal: pid lain yang hidup menahan; pid mati/diri sendiri tidak; dilepas hanya oleh pemiliknya', () => {
    const r = root(); mkdirSync(path.join(r, 'workspace'), { recursive: true });
    const first = acquireLock(r, 'orchestrator', () => false); expect(first.ok).toBe(true);
    writeFileSync(first.file, '424242');
    expect(acquireLock(r, 'orchestrator', () => true)).toMatchObject({ ok: false, pid: 424242 });
    expect(acquireLock(r, 'orchestrator', () => false).ok).toBe(true);
    releaseLock(first.file); // bukan pid kita sekarang? sudah ditimpa pid kita oleh acquire terakhir -> terlepas
  });
});

import http from 'node:http';
import { waitForPaperclip } from '../scripts/heartbeat.mjs';
describe('waitForPaperclip: basis URL dengan atau tanpa /api', () => {
  it('berhasil untuk http://host:port dan http://host:port/api (regresi: dulu menjadi /api/api/health dan menunggu selamanya)', async () => {
    const seen = [];
    const srv = http.createServer((req, res) => { seen.push(req.url); res.writeHead(req.url === '/api/health' ? 200 : 404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ status: 'ok' })); });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${srv.address().port}`;
    try {
      expect(await waitForPaperclip(base, { maxMs: 3000, pollMs: 100 })).toBe(true);
      expect(await waitForPaperclip(base + '/api', { maxMs: 3000, pollMs: 100 })).toBe(true);
      expect(await waitForPaperclip(base + '/api/', { maxMs: 3000, pollMs: 100 })).toBe(true);
      expect(seen.every((u) => u === '/api/health')).toBe(true);
    } finally { srv.close(); }
  });
  it('maxMs=0 tidak menunggu sama sekali (CLI sekali jalan)', async () => { expect(await waitForPaperclip('http://127.0.0.1:1', { maxMs: 0 })).toBe(true); });
  it('server tidak ada: menyerah setelah maxMs, tanpa melempar galat', async () => { expect(await waitForPaperclip('http://127.0.0.1:1', { maxMs: 600, pollMs: 100 })).toBe(false); });
});
