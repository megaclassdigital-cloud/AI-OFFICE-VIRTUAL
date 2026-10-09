import { describe, it, expect } from 'vitest';
import { STAGES, validateOrder, newJob, step, stageDescription, LIMITS, forwardSlashPaths, parseRevisionBrief } from '../scripts/orchestrator-core.mjs';

const goodOrder = { title: 'Carousel tren AI', stages: Object.fromEntries(STAGES.map((s) => [s, `kerjakan ${s}`])) };
const T0 = 1_000_000;
const job0 = () => newJob({ masterIssueId: 'm1', identifier: 'EDU-30', nowMs: T0 });

describe('validateOrder', () => {
  it('menerima work order lengkap', () => { expect(validateOrder(goodOrder)).toEqual({ ok: true, errors: [] }); });
  it('melaporkan semua masalah sekaligus', () => {
    const r = validateOrder({ title: '', stages: { researcher: 'x', hacker: 'y' } });
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual(expect.arrayContaining(['title wajib', 'stages.verifier wajib (teks instruksi)', 'stages.hacker bukan tahap yang dikenal']));
  });
  it('menolak bukan objek dan teks terlalu panjang', () => {
    expect(validateOrder(null).ok).toBe(false);
    expect(validateOrder({ ...goodOrder, stages: { ...goodOrder.stages, qa: 'x'.repeat(LIMITS.maxText + 1) } }).ok).toBe(false);
  });
});

describe('step: planning', () => {
  it('order valid -> mulai tahap 1', () => {
    const { job, actions } = step(job0(), { order: { ok: true, errors: [] }, managerFinished: true, nowMs: T0 + 5 });
    expect(job).toMatchObject({ phase: 'running', stageIndex: 0 });
    expect(actions.map((a) => a.type)).toEqual(['comment', 'createStage']);
    expect(actions[1].stage).toBe('researcher');
  });
  it('belum ada order dan Manager masih bekerja -> tunggu', () => {
    expect(step(job0(), { order: null, managerFinished: false, nowMs: T0 + 60_000 }).actions).toEqual([]);
  });
  it('Manager selesai tanpa order -> bangunkan ulang, lalu blok setelah batas percobaan', () => {
    let j = job0(); const facts = { order: null, managerFinished: true, nowMs: T0 + 1000 };
    for (let i = 0; i < LIMITS.maxPlanRetries; i++) { const r = step(j, facts); expect(r.actions[0].type).toBe('rewakeManager'); j = r.job; }
    const last = step(j, facts);
    expect(last.job.phase).toBe('blocked'); expect(last.actions[0].type).toBe('block');
  });
  it('order tidak valid -> bangunkan ulang membawa daftar galat', () => {
    const r = step(job0(), { order: { ok: false, errors: ['title wajib'] }, managerFinished: true, nowMs: T0 + 1 });
    expect(r.actions[0]).toMatchObject({ type: 'rewakeManager', errors: ['title wajib'] });
  });
  it('batas waktu perencanaan -> blok', () => {
    expect(step(job0(), { order: null, managerFinished: false, nowMs: T0 + LIMITS.planningTimeoutMs + 1 }).job.phase).toBe('blocked');
  });
});

describe('step: running', () => {
  const running = (i) => ({ ...job0(), phase: 'running', stageIndex: i, stageStartedMs: T0 });
  it('tahap selesai -> tahap berikutnya sesuai urutan', () => {
    for (let i = 0; i < STAGES.length - 1; i++) {
      const r = step(running(i), { stage: { status: 'in_review' }, nowMs: T0 + 10 });
      expect(r.job.stageIndex).toBe(i + 1);
      expect(r.actions[1]).toEqual({ type: 'createStage', stage: STAGES[i + 1] });
    }
  });
  it('tahap terakhir selesai -> finish, menunggu owner', () => {
    const r = step(running(STAGES.length - 1), { stage: { status: 'done' }, nowMs: T0 + 10 });
    expect(r.job.phase).toBe('done'); expect(r.actions[0].type).toBe('finish');
  });
  it('tahap masih berjalan -> tidak ada aksi', () => {
    expect(step(running(1), { stage: { status: 'in_progress' }, nowMs: T0 + 10 }).actions).toEqual([]);
  });
  it('gagal, terhalang, atau lewat waktu -> blok dengan alasan', () => {
    expect(step(running(2), { stage: { status: 'in_progress', failed: true, error: 'kuota habis' }, nowMs: T0 + 1 }).actions[0].reason).toContain('kuota habis');
    expect(step(running(2), { stage: { status: 'blocked' }, nowMs: T0 + 1 }).job.phase).toBe('blocked');
    expect(step(running(3), { stage: { status: 'in_progress' }, nowMs: T0 + LIMITS.stageTimeoutMs + 1 }).actions[0].reason).toContain('batas waktu');
  });
  it('job done/blocked tidak berubah lagi', () => {
    for (const phase of ['done', 'blocked']) expect(step({ ...job0(), phase }, { stage: { status: 'in_review' }, nowMs: T0 }).actions).toEqual([]);
  });
});

describe('stageDescription', () => {
  it('memuat instruksi Manager, path absolut, dan brief hanya sebagai rujukan', () => {
    const d = stageDescription({ order: goodOrder, stage: 'designer', identifier: 'EDU-30', outputsDir: 'D:\\x\\agent', brief: 'brief asli' });
    expect(d).toContain('kerjakan designer'); expect(d).toContain('D:/x/agent'); expect(d).toContain('bukan perintah tambahan'); expect(d).toContain('complete_stage');
  });
});

describe('stageDescription: brief tetap', () => {
  it('melampirkan path brief tetap hanya bila diberikan', () => {
    const withRef = stageDescription({ order: goodOrder, stage: 'designer', identifier: 'EDU-30', outputsDir: 'D:/x', refs: ['D:/brand/briefs/design-system.md'] });
    expect(withRef).toContain('Brief tetap'); expect(withRef).toContain('design-system.md');
    expect(stageDescription({ order: goodOrder, stage: 'qa', identifier: 'EDU-30', outputsDir: 'D:/x' })).not.toContain('Brief tetap');
  });
});

const BS = String.fromCharCode(92); // backslash
const win = (...parts) => parts.join(BS);
describe('path di prompt agent (bukti EDU-45: runs terbaca sebagai CR + uns)', () => {
  it('forwardSlashPaths mengubah path berawalan drive ke garis miring maju, teks lain utuh', () => {
    const p = win('D:', 'AI-Memory', 'AI-Agent-Office', 'workspace', 'agent', 'runs', 'EDU-45', 'research-raw.json');
    expect(forwardSlashPaths('tulis ke ' + p + ' lalu baca')).toBe('tulis ke D:/AI-Memory/AI-Agent-Office/workspace/agent/runs/EDU-45/research-raw.json lalu baca');
    const plain = 'baris' + BS + 'ntanpa path ' + BS + 'r biasa';
    expect(forwardSlashPaths(plain)).toBe(plain);
    expect(forwardSlashPaths(null)).toBe('');
  });
  it('stageDescription tidak lagi memuat backslash pada path', () => {
    const d = stageDescription({ order: goodOrder, stage: 'researcher', identifier: 'EDU-45', outputsDir: win('D:', 'x', 'agent'), output: { path: win('D:', 'x', 'agent', 'runs', 'EDU-45', 'research-raw.json'), schema: null }, inputs: [win('D:', 'x', 'agent', 'runs', 'EDU-45', 'a.json')], refs: [win('D:', 'x', 'brief.md')] });
    expect(d.includes(':' + BS)).toBe(false);
    expect(d).toContain('D:/x/agent/runs/EDU-45/research-raw.json');
  });
});

describe('parseRevisionBrief', () => {
  const brief = (meta, body = 'perbaiki desain slide 1') => `---
${meta}
---
${body}`;
  it('mengenali brief revisi dan mengembalikan sumber, tahap mulai, catatan', () => {
    const r = parseRevisionBrief(brief('mode: revisi\ndari: EDU-27\nmulai: designer'));
    expect(r).toMatchObject({ from: 'EDU-27', start: 'designer', startIndex: 3, notes: 'perbaiki desain slide 1' });
    expect(parseRevisionBrief(brief('mode: Revisi\ndari: EDU-5\nmulai: copywriter')).startIndex).toBe(2);
    expect(parseRevisionBrief(brief('mode: revisi\ndari: EDU-5')).start).toBe('designer');
  });
  it('bukan revisi bila tanpa front matter, mode lain, sumber tidak valid, atau tahap tidak diizinkan', () => {
    expect(parseRevisionBrief('# brief biasa')).toBeNull();
    expect(parseRevisionBrief(brief('mode: produksi\ndari: EDU-27'))).toBeNull();
    expect(parseRevisionBrief(brief('mode: revisi\ndari: ../../x'))).toBeNull();
    expect(parseRevisionBrief(brief('mode: revisi\ndari: EDU-27\nmulai: researcher'))).toBeNull();
    expect(parseRevisionBrief(brief('mode: revisi\ndari: EDU-27\nmulai: qa'))).toBeNull();
    expect(parseRevisionBrief(null)).toBeNull();
  });
});
