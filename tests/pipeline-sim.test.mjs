// Simulasi jalur perakitan: membuktikan aturan "satu agent satu konten, konten lain berjalan paralel di agent lain" untuk SEMUA tahap.
// Memakai decideAdvance/laneOf/canPromote/nextPlanned yang sama dengan orkestrator; hanya fakta Paperclip yang disintesis.
import { describe, it, expect } from 'vitest';
import { STAGES, newJob, decideAdvance, laneOf, canPromote, nextPlanned, MAX_ACTIVE_JOBS } from '../scripts/orchestrator-core.mjs';

const DUR = [3, 4, 2, 5, 3]; // lama tiap tahap (tick) per agent, sengaja berbeda agar konten saling menunggu

function simulate({ contents = 4, durations = DUR, maxTicks = 400 }) {
  let pending = Array.from({ length: contents }, (_, i) => ({ ...newJob({ masterIssueId: 'm' + i, identifier: 'C' + i, nowMs: 0 }), ready: true }));
  let jobs = []; const finished = []; const log = []; const visits = new Map();
  for (let tick = 1; tick <= maxTicks; tick++) {
    const nowMs = tick * 1000;
    const occupied = new Set();
    const next = [];
    for (let job of jobs) {
      if (job.phase !== 'done' && job.phase !== 'blocked') {
        if (job.sim && job.stageIssueId && !job.laneWait) job.sim.ticksLeft -= 1;
        const facts = job.phase === 'planning'
          ? { order: { ok: true, errors: [] }, nowMs }
          : { stage: { status: job.sim && job.sim.ticksLeft <= 0 ? 'in_review' : 'in_progress' }, output: { ok: true, errors: [] }, nowMs };
        const d = decideAdvance(job, facts, occupied);
        job = d.job;
        for (const a of d.actions) if (a.type === 'createStage') {
          job.stageIssueId = `${job.identifier}-s${STAGES.indexOf(a.stage)}`;
          job.sim = { ticksLeft: durations[STAGES.indexOf(a.stage)] };
          visits.set(job.identifier, [...(visits.get(job.identifier) ?? []), STAGES.indexOf(a.stage)]);
        }
      }
      const lane = laneOf(job);
      if (lane !== null) occupied.add(lane);
      if (job.phase === 'done' || job.phase === 'blocked') finished.push(job.identifier); else next.push(job);
    }
    jobs = next;
    // promosi: persis aturan orkestrator
    const planned = nextPlanned(pending);
    if (planned && canPromote(jobs)) {
      pending = pending.filter((p) => p !== planned);
      const { ready, ...rest } = planned;
      jobs.push({ ...rest, phase: 'planning', createdMs: nowMs });
    }
    // rekam siapa memegang tiap jalur pada tick ini
    const lanes = {};
    for (const j of jobs) { const l = laneOf(j); if (l !== null) (lanes[l] ??= []).push(j.identifier); }
    log.push({ tick, lanes, live: jobs.length });
    if (!jobs.length && !pending.length) break;
  }
  return { log, finished, visits, left: jobs.length + pending.length };
}

describe('jalur perakitan untuk semua tahap', () => {
  const r = simulate({ contents: 4 });

  it('semua konten selesai tanpa macet', () => {
    expect(r.left).toBe(0);
    expect(r.finished).toEqual(['C0', 'C1', 'C2', 'C3']);
  });
  it('INVARIAN: tiap agent (jalur) hanya memegang satu konten pada satu waktu, di semua tahap', () => {
    for (const t of r.log) for (const [lane, ids] of Object.entries(t.lanes)) expect(ids.length, `tick ${t.tick} jalur ${STAGES[lane]}: ${ids}`).toBeLessThanOrEqual(1);
  });
  it('INVARIAN: konten selesai berurutan seperti saat dimulai (tidak saling mendahului) dan melewati kelima tahap berurutan', () => {
    for (const id of r.finished) expect(r.visits.get(id)).toEqual([0, 1, 2, 3, 4]);
  });
  it('INVARIAN: batas konten aktif tidak terlampaui', () => {
    expect(Math.max(...r.log.map((t) => t.live))).toBeLessThanOrEqual(MAX_ACTIVE_JOBS);
  });
  it('PARALEL: Researcher mengambil konten berikutnya selagi konten sebelumnya sudah di tahap lain', () => {
    const hit = r.log.find((t) => t.lanes[0]?.[0] === 'C1' && Object.entries(t.lanes).some(([l, ids]) => Number(l) >= 1 && ids.includes('C0')));
    expect(hit, 'C1 di Researcher saat C0 sudah di tahap berikutnya').toBeTruthy();
  });
  it('PARALEL: setiap agent (kelima tahap) pernah bekerja bersamaan dengan agent lain pada konten yang berbeda', () => {
    for (let stage = 0; stage < STAGES.length; stage++) {
      const overlapped = r.log.some((t) => t.lanes[stage] && Object.entries(t.lanes).some(([l, ids]) => Number(l) !== stage && ids.some((id) => !t.lanes[stage].includes(id))));
      expect(overlapped, `tahap ${STAGES[stage]} tidak pernah paralel`).toBe(true);
    }
  });
  it('PARALEL: pada puncaknya sebagian besar agent bekerja bersamaan', () => {
    expect(Math.max(...r.log.map((t) => Object.keys(t.lanes).length))).toBeGreaterThanOrEqual(3);
  });
  it('lebih cepat daripada berurutan satu-satu (total tick < jumlah konten x total durasi)', () => {
    const sequential = 4 * DUR.reduce((a, b) => a + b, 0);
    expect(r.log.length).toBeLessThan(sequential * 0.8);
  });
  it('tahap yang lambat (Designer) tidak membuat agent di depannya menganggur selamanya, dan tidak ada kebuntuan untuk durasi apa pun', () => {
    for (const durations of [[1, 1, 1, 1, 1], [5, 1, 1, 1, 1], [1, 1, 1, 1, 6], [2, 7, 2, 7, 2]]) {
      const x = simulate({ contents: 5, durations });
      expect(x.left, JSON.stringify(durations)).toBe(0);
      expect(x.finished).toEqual(['C0', 'C1', 'C2', 'C3', 'C4']);
      for (const t of x.log) for (const ids of Object.values(t.lanes)) expect(ids.length).toBeLessThanOrEqual(1);
    }
  });
});
