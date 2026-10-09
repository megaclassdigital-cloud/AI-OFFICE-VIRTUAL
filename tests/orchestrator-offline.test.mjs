import { describe, it, expect } from 'vitest';
import { STAGES, LIMITS, newJob, step, isNetworkError } from '../scripts/orchestrator-core.mjs';
import { buildToastScript, notifyOwner } from '../scripts/notify.mjs';

const T0 = 1_000_000;
const running = (i, extra = {}) => ({ ...newJob({ masterIssueId: 'm1', identifier: 'EDU-50', nowMs: T0 }), phase: 'running', stageIndex: i, stageStartedMs: T0, ...extra });

describe('offline: tahan, bukan blok', () => {
  it('selama offline tidak ada aksi, tidak blok, dan waktu tidak dihitung ke batas waktu tahap', () => {
    let j = running(1);
    // tick 1 saat online sebagai jam dasar, lalu offline sangat lama (jauh melewati stageTimeout)
    j = step(j, { stage: { status: 'in_progress' }, nowMs: T0 + 10_000 }).job;
    const hours = 3 * 60 * 60_000;
    const ticks = [];
    for (let t = T0 + 25_000; t < T0 + hours; t += 15_000 * 240) ticks.push(t);
    ticks.push(T0 + hours); // tick offline terakhir tepat sebelum online (tick nyata tiap 15 detik)
    for (const t of ticks) {
      const r = step(j, { offline: true, stage: { status: 'in_progress', failed: true, error: 'Cannot connect to API' }, nowMs: t });
      expect(r.actions).toEqual([]); expect(r.job.phase).toBe('running'); j = r.job;
    }
    expect(j.heldSince).toBeTruthy();
    // setelah online: sisa waktu stage masih nyaris utuh, tidak langsung kena timeout
    const back = step(j, { stage: { status: 'in_progress' }, nowMs: T0 + hours + 15_000 });
    expect(back.job.phase).toBe('running'); expect(back.actions).toEqual([]); expect(back.job.heldSince).toBeNull();
  });
  it('perencanaan juga ditahan dan batas waktunya tidak berjalan saat offline', () => {
    let j = newJob({ masterIssueId: 'm1', identifier: 'EDU-50', nowMs: T0 });
    j = step(j, { order: null, managerFinished: false, nowMs: T0 + 1000 }).job;
    const r = step(j, { offline: true, order: null, managerFinished: false, nowMs: T0 + LIMITS.planningTimeoutMs * 5 });
    expect(r.job.phase).toBe('planning'); expect(r.actions).toEqual([]);
  });
  it('job done/blocked tidak terpengaruh offline', () => {
    for (const phase of ['done', 'blocked']) expect(step({ ...running(1), phase }, { offline: true, nowMs: T0 }).job.phase).toBe(phase);
  });
});

describe('online kembali: ulang tahap karena jaringan, tanpa menghabiskan jatah percobaan', () => {
  it('galat jaringan -> retryStage network=true, stageAttempts tidak bertambah', () => {
    const r = step(running(4, { stageAttempts: 1 }), { stage: { status: 'in_progress', failed: true, error: 'Cannot connect to API: Unable to connect.' }, nowMs: T0 + 5 });
    expect(r.actions[0]).toMatchObject({ type: 'retryStage', stage: STAGES[4], network: true });
    expect(r.job).toMatchObject({ netRetries: 1, phase: 'running' }); expect(r.job.stageAttempts).toBe(1);
  });
  it('tetap ada batas aman: setelah jatah jaringan habis, jatuh ke percobaan biasa lalu blok', () => {
    const r = step(running(4, { netRetries: LIMITS.maxNetRetries, stageAttempts: LIMITS.maxStageAttempts }), { stage: { status: 'in_progress', failed: true, error: 'Cannot connect to API' }, nowMs: T0 + 5 });
    expect(r.job.phase).toBe('blocked');
  });
  it('galat kuota tetap diperlakukan sebagai galat biasa (bukan jaringan)', () => {
    expect(isNetworkError('You exceeded your current quota')).toBe(false);
  });
});

describe('notify (best-effort, aman)', () => {
  it('kutip ganda aman, teks dipotong, newline dibuang', () => {
    const s = buildToastScript("Judul 'x'", "baris1\nbaris2 ' ); Remove-Item C:\\ -Recurse #" + 'a'.repeat(500));
    expect(s).toContain("Judul ''x''");
    expect(s).not.toMatch(/\n/);
    expect(s.length).toBeLessThan(900);
  });
  it('dapat dimatikan lewat env dan tidak pernah melempar', () => {
    process.env.AAO_NOTIFY_DISABLED = '1';
    expect(notifyOwner('a', 'b')).toBe(false);
    delete process.env.AAO_NOTIFY_DISABLED;
  });
});
