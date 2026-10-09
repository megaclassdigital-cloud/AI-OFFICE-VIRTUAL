import { describe, it, expect } from 'vitest';
import { normalizeLimits, enforce } from '../plugins/aao-approval-gate/src/usage-guard.js';

const NOW = Date.parse('2026-10-09T08:00:00Z');
const runsFor = (agentId, n) => Array.from({ length: n }, (_, i) => ({ agentId, startedAt: `2026-10-09T0${i % 8}:00:00Z`, finishedAt: `2026-10-09T0${i % 8}:01:00Z` }));
const mk = (runs, names) => {
  const log = { paused: [] };
  return {
    log,
    deps: {
      listRuns: async () => runs,
      getAgent: async (id) => ({ id, name: names[id], status: 'idle' }),
      pauseAgent: async (id) => log.paused.push(id),
      audit: async () => {},
    },
  };
};

describe('batas per agent (perAgent)', () => {
  const limitsRaw = { maxRunsPerAgentPerDay: 6, perAgent: { Manager: { maxRunsPerAgentPerDay: 40 } } };

  it('Manager boleh melewati batas umum, agent lain tetap di-pause', async () => {
    const { log, deps } = mk([...runsFor('m', 10), ...runsFor('r', 7)], { m: 'Manager', r: 'Researcher' });
    const r = await enforce({ companyId: 'c', limitsRaw, nowMs: NOW, deps });
    expect(r.paused).toEqual(['r']);
    expect(log.paused).toEqual(['r']);
  });

  it('Manager tetap di-pause saat melewati batas khususnya', async () => {
    const { deps } = mk(runsFor('m', 40), { m: 'Manager' });
    expect((await enforce({ companyId: 'c', limitsRaw, nowMs: NOW, deps })).paused).toEqual(['m']);
  });

  it('tanpa perAgent perilaku lama tidak berubah', async () => {
    const { deps } = mk(runsFor('m', 6), { m: 'Manager' });
    expect((await enforce({ companyId: 'c', limitsRaw: { maxRunsPerAgentPerDay: 6 }, nowMs: NOW, deps })).paused).toEqual(['m']);
  });

  it('validasi perAgent ketat: kunci tak dikenal, angka salah, bukan objek', () => {
    expect(() => normalizeLimits({ perAgent: { Manager: { maxRunsPerAgentPerDay: 0 } } })).toThrow();
    expect(() => normalizeLimits({ perAgent: { Manager: { bebas: 5 } } })).toThrow();
    expect(() => normalizeLimits({ perAgent: [] })).toThrow();
    expect(() => normalizeLimits({ perAgent: { Manager: { maxMinutesPerAgentPerDay: 120 } } })).not.toThrow();
  });
});
