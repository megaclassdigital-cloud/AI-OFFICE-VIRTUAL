// Test guard pemakaian (F1.0f) dengan run tiruan.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeLimits, startOfLocalDay, summarizeRuns, evaluate, enforce, DEFAULT_LIMITS } from '../plugins/aao-approval-gate/src/usage-guard.js';
import { repoRoot } from './helpers.mjs';

const L = normalizeLimits({});
// 2026-10-08 12:00 WIB = 05:00Z
const NOW = Date.parse('2026-10-08T05:00:00Z');
const run = (agentId, startIso, minutes) => ({
  agentId,
  startedAt: startIso,
  finishedAt: new Date(Date.parse(startIso) + minutes * 60_000).toISOString(),
});

describe('limits', () => {
  it('default 6 run / 60 menit / WIB', () => {
    expect(DEFAULT_LIMITS).toMatchObject({ maxRunsPerAgentPerDay: 6, maxMinutesPerAgentPerDay: 60, timezoneOffsetMinutes: 420 });
  });
  it('file limits.json EdukasiAI valid (batas umum 30, Manager 40 lewat perAgent)', () => {
    const f = JSON.parse(readFileSync(path.join(repoRoot, 'divisions', 'edukasiai', 'limits.json'), 'utf8'));
    const l = normalizeLimits(f);
    expect(l).toMatchObject({ maxRunsPerAgentPerDay: 30, maxMinutesPerAgentPerDay: 240, timezoneOffsetMinutes: 420 });
    expect(l.perAgent.Manager).toEqual({ maxRunsPerAgentPerDay: 40, maxMinutesPerAgentPerDay: 240 });
  });
  it('nilai tidak valid ditolak, bukan diam-diam longgar', () => {
    expect(() => normalizeLimits({ maxRunsPerAgentPerDay: 0 })).toThrow();
    expect(() => normalizeLimits({ maxMinutesPerAgentPerDay: 'banyak' })).toThrow();
    expect(() => normalizeLimits({ timezoneOffsetMinutes: 99999 })).toThrow();
  });
});

describe('hari lokal WIB', () => {
  it('awal hari = 00:00 WIB (17:00Z hari sebelumnya)', () => {
    expect(new Date(startOfLocalDay(NOW, 420)).toISOString()).toBe('2026-10-07T17:00:00.000Z');
  });
  it('run sebelum tengah malam WIB tidak dihitung hari ini', () => {
    const s = summarizeRuns([run('a1', '2026-10-07T16:59:00Z', 10), run('a1', '2026-10-07T17:01:00Z', 10)], NOW, L);
    expect(s.get('a1')).toMatchObject({ runs: 1 });
  });
});

describe('evaluate', () => {
  it('6 run -> melanggar; 5 run -> aman', () => {
    const five = Array.from({ length: 5 }, (_, i) => run('a1', `2026-10-08T0${i}:00:00Z`, 1));
    expect(evaluate(summarizeRuns(five, NOW, L), L)).toEqual([]);
    const six = [...five, run('a1', '2026-10-08T04:30:00Z', 1)];
    const v = evaluate(summarizeRuns(six, NOW, L), L);
    expect(v).toHaveLength(1);
    expect(v[0].reasons[0]).toMatch(/run 6\/6/);
  });
  it('durasi 60 menit total -> melanggar dengan 4 run panjang', () => {
    const v = evaluate(summarizeRuns([run('a1', '2026-10-08T01:00:00Z', 15), run('a1', '2026-10-08T02:00:00Z', 15), run('a1', '2026-10-08T03:00:00Z', 15), run('a1', '2026-10-08T04:00:00Z', 15)], NOW, L), L);
    expect(v[0].reasons.join()).toMatch(/durasi 60\.0\/60/);
  });
  it('run yang masih berjalan dihitung sampai sekarang (maksimal batas wajar satu run)', () => {
    const s = summarizeRuns([{ agentId: 'a1', startedAt: '2026-10-08T03:00:00Z' }], NOW, L);
    expect(s.get('a1').minutes).toBeCloseTo(15, 5);
    expect(evaluate(s, L)).toHaveLength(0);
  });
  it('agent dihitung terpisah', () => {
    const rs = Array.from({ length: 6 }, (_, i) => run('boros', `2026-10-08T0${i}:00:00Z`, 1));
    const v = evaluate(summarizeRuns([...rs, run('hemat', '2026-10-08T01:00:00Z', 1)], NOW, L), L);
    expect(v.map((x) => x.agentId)).toEqual(['boros']);
  });
  it('data rusak (tanpa startedAt) diabaikan', () => {
    expect(summarizeRuns([{ agentId: 'a1' }, { agentId: 'a1', startedAt: 'bukan-tanggal' }], NOW, L).size).toBe(0);
  });
});

describe('enforce', () => {
  function deps(runs, status = 'idle') {
    const log = { paused: [], audit: [] };
    return {
      log,
      deps: {
        listRuns: async () => runs,
        getAgent: async (id) => ({ id, name: 'Researcher', status }),
        pauseAgent: async (id) => log.paused.push(id),
        audit: async (e) => log.audit.push(e),
      },
    };
  }
  const six = Array.from({ length: 6 }, (_, i) => run('a1', `2026-10-08T0${i}:00:00Z`, 1));

  it('melewati batas -> agent di-pause dan tercatat di audit', async () => {
    const { log, deps: d } = deps(six);
    const r = await enforce({ companyId: 'co1', nowMs: NOW, deps: d });
    expect(r.paused).toEqual(['a1']);
    expect(log.paused).toEqual(['a1']);
    expect(log.audit).toHaveLength(1);
    expect(log.audit[0]).toMatchObject({ companyId: 'co1', entityType: 'agent', entityId: 'a1' });
    expect(log.audit[0].message).toMatch(/run 6\/6/);
  });
  it('idempoten: agent yang sudah paused tidak di-pause/diaudit lagi', async () => {
    const { log, deps: d } = deps(six, 'paused');
    const r = await enforce({ companyId: 'co1', nowMs: NOW, deps: d });
    expect(r.paused).toEqual([]);
    expect(log.paused).toEqual([]);
    expect(log.audit).toEqual([]);
  });
  it('di bawah batas -> tidak ada tindakan', async () => {
    const { log, deps: d } = deps(six.slice(0, 5));
    expect((await enforce({ companyId: 'co1', nowMs: NOW, deps: d })).paused).toEqual([]);
    expect(log.paused).toEqual([]);
  });
  it('batas khusus dari konfigurasi dipakai (mis. 2 run)', async () => {
    const { deps: d } = deps(six.slice(0, 2));
    const r = await enforce({ companyId: 'co1', nowMs: NOW, limitsRaw: { maxRunsPerAgentPerDay: 2 }, deps: d });
    expect(r.paused).toEqual(['a1']);
  });
});

describe('run yatim tidak menghabiskan kuota durasi', () => {
  it('satu run tanpa finishedAt yang "berjalan" 7 jam dihitung maksimal MAX_RUN_MINUTES', async () => {
    const { MAX_RUN_MINUTES } = await import('../plugins/aao-approval-gate/src/usage-guard.js');
    const now = Date.parse('2026-10-10T06:00:00Z');
    const s = summarizeRuns([{ agentId: 'a1', startedAt: '2026-10-09T23:00:00Z' }, { agentId: 'a1', startedAt: '2026-10-10T05:00:00Z', finishedAt: '2026-10-10T05:05:00Z' }], now, { timezoneOffsetMinutes: 420 });
    expect(s.get('a1').runs).toBe(2);
    expect(s.get('a1').minutes).toBe(MAX_RUN_MINUTES + 5);
  });
});
