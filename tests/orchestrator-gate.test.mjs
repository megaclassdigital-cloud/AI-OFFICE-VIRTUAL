import { describe, it, expect } from 'vitest';
import { STAGES, STAGE_OUTPUT, LIMITS, newJob, step, stageDescription, outputPath, artifactPath, checkQaResult } from '../scripts/orchestrator-core.mjs';

const T0 = 1_000_000;
const running = (i, extra = {}) => ({ ...newJob({ masterIssueId: 'm1', identifier: 'EDU-40', nowMs: T0 }), phase: 'running', stageIndex: i, stageStartedMs: T0, ...extra });
const order = { title: 't', stages: Object.fromEntries(STAGES.map((s) => [s, 'x'])) };

describe('outputPath / keluaran baku', () => {
  it('setiap tahap punya berkas, dan skema ada kecuali QA', () => {
    for (const s of STAGES) expect(STAGE_OUTPUT[s].file).toMatch(/\.json$/);
    expect(STAGE_OUTPUT.qa.schema).toBeNull();
    expect(STAGE_OUTPUT.copywriter.schema).toBe('carousel');
  });
  it('path memakai pemisah yang diminta, tanpa dobel pemisah', () => {
    expect(outputPath('D:/a/agent/', 'EDU-40', 'researcher')).toBe('D:/a/agent/runs/EDU-40/research-raw.json');
    expect(artifactPath('D:/a/agent/', 'EDU-40', 'researcher')).toBe('D:/a/agent/runs/EDU-40/research-output.json');
    expect(artifactPath('D:/a/agent', 'EDU-40', 'copywriter')).toBe('D:/a/agent/runs/EDU-40/carousel.json');
    expect(outputPath('D:\\a\\agent', 'EDU-40', 'designer', '\\')).toBe('D:\\a\\agent\\runs\\EDU-40\\carousel-design.json');
  });
});

describe('checkQaResult', () => {
  it('lolos hanya untuk passed=true', () => {
    expect(checkQaResult({ passed: true, notes: [] })).toEqual({ ok: true, errors: [] });
  });
  it('passed=false = vonis akhir (fatal) dengan catatan; format salah ditolak biasa', () => {
    const r = checkQaResult({ passed: false, notes: ['teks terpotong'] });
    expect(r).toMatchObject({ ok: false, fatal: true }); expect(r.errors[0]).toContain('teks terpotong');
    expect(checkQaResult({ passed: 'ya' })).toMatchObject({ ok: false }); expect(checkQaResult(null).fatal).toBeUndefined();
  });
});

describe('step: gerbang keluaran', () => {
  const done = { status: 'in_review' };
  it('keluaran lolos -> lanjut tahap berikut dan hitung ulang percobaan', () => {
    const r = step(running(0, { stageRetries: 1 }), { stage: done, output: { ok: true, errors: [] }, nowMs: T0 + 5 });
    expect(r.job).toMatchObject({ stageIndex: 1, stageRetries: 0 });
    expect(r.actions[1]).toEqual({ type: 'createStage', stage: 'verifier' });
  });
  it('keluaran tidak lolos -> tolak sekali dengan daftar galat, tetap di tahap yang sama', () => {
    const r = step(running(1), { stage: done, output: { ok: false, errors: ['file keluaran belum ada: X'] }, nowMs: T0 + 5 });
    expect(r.job).toMatchObject({ stageIndex: 1, stageRetries: 1, phase: 'running' });
    expect(r.actions).toEqual([{ type: 'rejectStage', errors: ['file keluaran belum ada: X'] }]);
  });
  it('batas percobaan habis -> blok dengan alasan', () => {
    const r = step(running(1, { stageRetries: LIMITS.maxStageRetries }), { stage: done, output: { ok: false, errors: ['slot terlalu panjang'] }, nowMs: T0 + 5 });
    expect(r.job.phase).toBe('blocked'); expect(r.actions[0].reason).toContain('slot terlalu panjang');
  });
  it('vonis fatal (QA menolak) -> langsung blok tanpa tolak ulang', () => {
    const r = step(running(4), { stage: done, output: { ok: false, fatal: true, errors: ['QA menolak: teks terpotong'] }, nowMs: T0 + 5 });
    expect(r.job.phase).toBe('blocked'); expect(r.actions).toHaveLength(1);
  });
  it('tanpa gerbang (output tidak diberikan) perilaku lama tetap: selesai = lanjut', () => {
    expect(step(running(2), { stage: done, nowMs: T0 + 5 }).job.stageIndex).toBe(3);
  });
});

describe('stageDescription: masukan dan keluaran', () => {
  it('memuat masukan tahap sebelumnya dan keluaran wajib dengan skema', () => {
    const d = stageDescription({ order, stage: 'verifier', identifier: 'EDU-40', outputsDir: 'D:/x', inputs: ['D:/x/runs/EDU-40/research-output.json'], output: { path: 'D:/x/runs/EDU-40/verification-result.json', schema: 'verification-result' } });
    expect(d).toContain('research-output.json'); expect(d).toContain('KELUARAN WAJIB'); expect(d).toContain('verification-result');
  });
  it('tanpa output/inputs tidak menambah bagian tersebut', () => {
    const d = stageDescription({ order, stage: 'qa', identifier: 'EDU-40', outputsDir: 'D:/x' });
    expect(d).not.toContain('KELUARAN WAJIB'); expect(d).not.toContain('Masukan dari tahap');
  });
});

import { isTransientError } from '../scripts/orchestrator-core.mjs';
describe('percobaan ulang otomatis untuk galat sementara', () => {
  it('mengenali galat penyedia model yang sementara, bukan galat tugas', () => {
    for (const t of ['503 This model is currently experiencing high demand', 'Upstream request failed: Endpoint is unavailable.', 'Requests ending with a model turn are not supported.', 'ACP agent reported a terminal service failure.', 'Timed out after 600s']) expect(isTransientError(t), t).toBe(true);
    for (const t of ['schema validation failed', 'file keluaran belum ada', '', null]) expect(isTransientError(t), String(t)).toBe(false);
  });
  it('gagal sementara -> ulang tahap yang sama, maksimal 3 percobaan lalu blok', () => {
    let j = running(2, { stageAttempts: 1 });
    for (const expectAttempt of [2, 3]) {
      const r = step(j, { stage: { status: 'in_progress', failed: true, error: '503 high demand' }, nowMs: T0 + 5 });
      expect(r.actions[0]).toMatchObject({ type: 'retryStage', stage: 'copywriter' });
      expect(r.job.stageAttempts).toBe(expectAttempt); j = r.job;
    }
    const last = step({ ...j, stageIssueId: 'x' }, { stage: { status: 'in_progress', failed: true, error: '503 high demand' }, nowMs: T0 + 5 });
    expect(last.job.phase).toBe('blocked');
  });
  it('gagal non-sementara langsung blok tanpa ulang', () => {
    const r = step(running(2, { stageAttempts: 1 }), { stage: { status: 'in_progress', failed: true, error: 'schema validation failed' }, nowMs: T0 + 5 });
    expect(r.job.phase).toBe('blocked'); expect(r.actions[0].type).toBe('block');
  });
});
