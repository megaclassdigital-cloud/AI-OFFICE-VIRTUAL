import { describe, it, expect } from 'vitest';
import { isInfraBlock, decideAutoRetry, agentsToHeal, holdFallbackDecision, fallbackFeedback } from '../scripts/sustain-core.mjs';
import { decideAutoBrief } from '../scripts/autonomy-core.mjs';

const MIN = 60_000; const NOW = 1_800_000_000_000;
const blocked = (over = {}) => ({ phase: 'blocked', stageIndex: 2, blockReason: 'tahap Copywriter gagal: Process lost -- child pid 21388 is no longer running', endedMs: NOW - 10 * MIN, ...over });
const ok = { paperclipOk: true, anotherActive: false, nowMs: NOW };

describe('pemulihan mandiri: coba ulang tahap terblokir', () => {
  it('gangguan infrastruktur dikenali; penolakan mutu tidak', () => {
    for (const r of ['Process lost -- child pid 1', 'fetch failed', 'claude_auth_required', 'ECONNRESET', 'run timed out', 'plugin approval-gate belum siap', 'Adapter failed', 'HTTP 503']) expect(isInfraBlock(r), r).toBe(true);
    for (const r of ['QA menolak: font salah', 'work order tidak valid', 'jatah revisi habis', '', null, undefined]) expect(isInfraBlock(r), String(r)).toBe(false);
  });
  it('mencoba ulang bila infra + Paperclip sehat + tidak ada job aktif + cukup lama + jatah ada', () => {
    expect(decideAutoRetry({ job: blocked(), ...ok })).toMatchObject({ retry: true, attempt: 1 });
    expect(decideAutoRetry({ job: blocked({ autoRetries: 1 }), ...ok })).toMatchObject({ retry: true, attempt: 2 });
  });
  it('tidak mencoba ulang: jatah habis, bukan infra, Paperclip belum sehat, ada job aktif, belum ada tahap, terlalu lama, terlalu baru', () => {
    expect(decideAutoRetry({ job: blocked({ autoRetries: 2 }), ...ok }).code).toBe('jatah-habis');
    expect(decideAutoRetry({ job: blocked({ blockReason: 'QA menolak' }), ...ok }).code).toBe('bukan-infrastruktur');
    expect(decideAutoRetry({ job: blocked(), ...ok, paperclipOk: false }).code).toBe('paperclip-belum-sehat');
    expect(decideAutoRetry({ job: blocked(), ...ok, anotherActive: true }).code).toBe('ada-job-aktif');
    expect(decideAutoRetry({ job: blocked({ stageIndex: -1 }), ...ok }).code).toBe('belum-ada-tahap');
    expect(decideAutoRetry({ job: blocked({ endedMs: NOW - 4 * 3_600_000 }), ...ok }).code).toBe('terlalu-lama');
    expect(decideAutoRetry({ job: blocked({ endedMs: NOW - MIN }), ...ok })).toMatchObject({ retry: false, code: 'tunggu-pulih' });
    expect(decideAutoRetry({ job: { phase: 'done' }, ...ok }).code).toBe('bukan-terblokir');
    expect(decideAutoRetry({ job: undefined, ...ok }).retry).toBe(false);
  });
});

describe('pemulihan mandiri: status error agen', () => {
  const agents = [{ id: 'a', name: 'Researcher', status: 'error', lastHeartbeatAt: new Date(NOW - 30 * MIN).toISOString() }, { id: 'b', name: 'Manager', status: 'error', lastHeartbeatAt: new Date(NOW - MIN).toISOString() },
    { id: 'c', name: 'QA', status: 'idle' }, { id: 'd', name: 'Designer', status: 'paused' }, { id: 'e', name: 'Verifier', status: 'error' }];
  it('hanya error yang sudah lama; tidak menyentuh agen tahap aktif, yang idle, atau yang DIJEDA owner', () => {
    expect(agentsToHeal({ agents, activeAgentName: null, nowMs: NOW }).map((a) => a.id)).toEqual(['a', 'e']);
    expect(agentsToHeal({ agents, activeAgentName: 'Researcher', nowMs: NOW }).map((a) => a.id)).toEqual(['e']);
    expect(agentsToHeal({ agents: undefined, nowMs: NOW })).toEqual([]);
  });
});

describe('gambar asli tak kunjung tersedia', () => {
  const since = NOW - 40 * MIN;
  it('hanya konten otomatis, setelah 30 menit, dengan jatah 2 putaran', () => {
    expect(holdFallbackDecision({ auto: true, sinceMs: since, nowMs: NOW }).fallback).toBe(true);
    expect(holdFallbackDecision({ auto: false, sinceMs: since, nowMs: NOW }).code).toBe('bukan-otomatis'); // brief owner: owner yang memutuskan
    expect(holdFallbackDecision({ auto: true, sinceMs: NOW - 10 * MIN, nowMs: NOW }).code).toBe('belum-waktunya');
    expect(holdFallbackDecision({ auto: true, sinceMs: since, nowMs: NOW, rounds: 2 }).code).toBe('jatah-habis');
    expect(holdFallbackDecision({ auto: true, sinceMs: 0, nowMs: NOW }).fallback).toBe(false);
  });
  it('umpan balik menyebut berkas dan melarang gambar pengganti tak terverifikasi', () => {
    const t = fallbackFeedback([{ file: 'securebio-accenture.png', reason: 'google: blocked' }], 41);
    expect(t).toMatch(/securebio-accenture\.png/); expect(t).toMatch(/TANPA gambar itu/); expect(t).toMatch(/placeholder/);
  });
});

describe('kantor otonom menahan diri saat RAM menipis', () => {
  it('lowMemory => tidak membuat brief', () => {
    const ctx = { settings: {}, nowMs: Date.parse('2026-10-17T03:00:00Z'), paused: false, offline: false, idle: { job: false, followers: 0, pending: 0, inbox: 0 }, awaitingOwner: 0, briefLog: [], recentAutoOutcomes: [] };
    expect(decideAutoBrief(ctx).act).toBe(true);
    expect(decideAutoBrief({ ...ctx, lowMemory: true })).toMatchObject({ act: false, code: 'ram-menipis' });
  });
});
