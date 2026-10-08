// Test F2.4: routine nonaktif secara default, anti duplikat (kebijakan + installer idempoten), tidak pernah dijalankan.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildRoutineSpec, installRoutine, ROUTINE_TITLE, CRON, TIMEZONE } from '../scripts/install-routine.mjs';
import { repoRoot } from './helpers.mjs';

const IDS = { companyId: 'co', assigneeAgentId: '11111111-1111-4111-8111-111111111111', projectId: '22222222-2222-4222-8222-222222222222' };

function fakeClient() {
  const store = new Map(); const triggers = new Map(); const calls = [];
  let n = 0;
  const view = (r) => ({ ...r, triggers: [...triggers.values()].filter((t) => t.routineId === r.id) });
  return {
    calls, store, triggers,
    routines: async () => [...store.values()].map((r) => ({ id: r.id, title: r.title, status: r.status })),
    getRoutine: async (id) => view(store.get(id)),
    createRoutine: async (_c, body) => { calls.push('createRoutine'); const r = { id: `r${++n}`, ...body }; store.set(r.id, r); return r; },
    patchRoutine: async (id, b) => { calls.push('patchRoutine'); Object.assign(store.get(id), b); },
    createTrigger: async (rid, b) => { calls.push('createTrigger'); const t = { id: `t${++n}`, routineId: rid, ...b }; triggers.set(t.id, t); return { trigger: t }; },
    patchTrigger: async (id, b) => { calls.push('patchTrigger'); Object.assign(triggers.get(id), b); },
  };
}

describe('spec routine', () => {
  const s = buildRoutineSpec(IDS);
  it('nonaktif secara default: routine paused dan trigger enabled=false', () => {
    expect(s.routine.status).toBe('paused');
    expect(s.trigger.enabled).toBe(false);
  });
  it('Senin-Jumat 07.00 WIB', () => {
    expect(s.trigger).toMatchObject({ kind: 'schedule', cronExpression: '0 7 * * 1-5', timezone: 'Asia/Jakarta' });
    expect([CRON, TIMEZONE]).toEqual(['0 7 * * 1-5', 'Asia/Jakarta']);
  });
  it('anti duplikat: skip_if_active dan skip_missed', () => {
    expect(s.routine).toMatchObject({ concurrencyPolicy: 'skip_if_active', catchUpPolicy: 'skip_missed' });
  });
  it('berhenti di owner: deskripsi menyebut in_review dan tanpa posting otomatis', () => {
    expect(s.routine.description).toMatch(/in_review/);
    expect(s.routine.description).toMatch(/tidak ada posting otomatis/);
  });
});

describe('installRoutine', () => {
  it('pasang pertama: satu routine dan satu trigger, keduanya nonaktif', async () => {
    const c = fakeClient();
    const r = await installRoutine(c, IDS);
    expect(r).toMatchObject({ created: true, status: 'paused' });
    expect(r.trigger).toEqual([{ kind: 'schedule', enabled: false, cron: '0 7 * * 1-5', timezone: 'Asia/Jakarta' }]);
  });
  it('dipasang dua kali (atau tiga): tetap satu routine, satu trigger', async () => {
    const c = fakeClient();
    await installRoutine(c, IDS); const b = await installRoutine(c, IDS); await installRoutine(c, IDS);
    expect(b.created).toBe(false);
    expect(c.store.size).toBe(1);
    expect(c.triggers.size).toBe(1);
    expect(c.calls.filter((x) => x === 'createRoutine')).toHaveLength(1);
  });
  it('pemasangan ulang tanpa flag tidak mengubah routine yang sudah diaktifkan owner', async () => {
    const c = fakeClient();
    await installRoutine(c, IDS);
    await installRoutine(c, IDS, { enable: true });
    const r = await installRoutine(c, IDS);
    expect(r.status).toBe('active');
    expect(r.trigger[0].enabled).toBe(true);
  });
  it('--enable mengaktifkan routine dan trigger; --disable mengembalikan keduanya', async () => {
    const c = fakeClient();
    const on = await installRoutine(c, IDS, { enable: true });
    expect([on.status, on.trigger[0].enabled]).toEqual(['active', true]);
    const off = await installRoutine(c, IDS, { disable: true });
    expect([off.status, off.trigger[0].enabled]).toEqual(['paused', false]);
  });
  it('lebih dari satu routine berjudul sama: berhenti dan minta owner merapikan', async () => {
    const c = fakeClient();
    await c.createRoutine('co', { title: ROUTINE_TITLE, status: 'paused' });
    await c.createRoutine('co', { title: ROUTINE_TITLE, status: 'paused' });
    await expect(installRoutine(c, IDS)).rejects.toThrow(/rapikan manual/);
  });
  it('--enable dan --disable bersamaan ditolak', async () => {
    await expect(installRoutine(fakeClient(), IDS, { enable: true, disable: true })).rejects.toThrow(/bersamaan/);
  });
  it('skrip tidak pernah memanggil endpoint run/fire', () => {
    const src = readFileSync(path.join(repoRoot, 'scripts', 'install-routine.mjs'), 'utf8');
    expect(src).not.toMatch(/\/run['`"]|\/fire/);
  });
});
