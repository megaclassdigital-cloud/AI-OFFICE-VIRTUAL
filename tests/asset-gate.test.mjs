import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { imageSlotsUsed, matchRequests, manifestVerdict, holdMessage, inboxSignature, shouldRetryCapture, HOLD_RETRY_MS } from '../scripts/asset-gate.mjs';
import { step, newJob } from '../scripts/orchestrator-core.mjs';

const templates = { 'hero-cover': { slots: { hero: { type: 'image' }, title: { type: 'text' } } }, cover: { slots: { title: { type: 'text' } } } };
const design = { slides: [
  { index: 1, template: 'hero-cover', slots: { hero: 'runs/EDU-9/assets/claude-logo.png', title: 'x' } },
  { index: 2, template: 'hero-cover', slots: { hero: 'brand/static.png', title: 'y' } },
  { index: 3, template: 'cover', slots: { title: 'z' } },
] };

describe('asset-gate', () => {
  it('imageSlotsUsed hanya mengambil gambar runs/<ID>/assets (brand/ dan teks diabaikan)', () => {
    expect(imageSlotsUsed(design, templates, 'EDU-9')).toEqual([{ slide: 1, slot: 'hero', file: 'claude-logo.png' }]);
    expect(imageSlotsUsed(design, templates, 'EDU-10')).toEqual([]);
  });

  it('matchRequests: permintaan hilang atau slide tidak cocok ditolak', () => {
    const used = imageSlotsUsed(design, templates, 'EDU-9');
    expect(matchRequests(used, { requests: [] }).join()).toMatch(/belum ada di asset-requests/);
    expect(matchRequests(used, { requests: [{ slide: 2, file: 'claude-logo.png', kind: 'brand', query: 'q' }] }).join()).toMatch(/bertanda slide 2/);
    expect(matchRequests(used, { requests: [{ slide: 1, file: 'claude-logo.png', kind: 'brand', query: 'q' }] })).toEqual([]);
    expect(matchRequests([], undefined)).toEqual([]);
  });

  it('manifestVerdict: hanya captured/owner-supplied/kept dianggap ada; blocked/missing/tidak tercatat = kurang', () => {
    const m = { assets: [{ file: 'a.png', status: 'captured' }, { file: 'b.png', status: 'owner-supplied' }, { file: 'c.png', status: 'blocked', reason: 'captcha' }, { file: 'd.png', status: 'missing' }] };
    expect(manifestVerdict(m, ['a.png', 'b.png']).complete).toBe(true);
    const v = manifestVerdict(m, ['a.png', 'c.png', 'd.png', 'e.png']);
    expect(v.complete).toBe(false);
    expect(v.missing.map((x) => x.file)).toEqual(['c.png', 'd.png', 'e.png']);
    expect(manifestVerdict(null, ['a.png']).complete).toBe(false);
  });

  it('holdMessage menyebut berkas dan cara melanjutkan (inbox + browser-login)', () => {
    const t = holdMessage('EDU-9', [{ file: 'claude-logo.png', status: 'blocked', reason: 'captcha' }]);
    expect(t).toMatch(/DITAHAN/); expect(t).toMatch(/claude-logo\.png/); expect(t).toMatch(/workspace\/inbox\/assets\/EDU-9/); expect(t).toMatch(/browser-login/);
  });

  it('shouldRetryCapture: belum pernah, inbox berubah, atau lewat jeda', () => {
    expect(shouldRetryCapture(null, '', 0)).toBe(true);
    const h = { at: 1000, sig: 's' };
    expect(shouldRetryCapture(h, 's', 1000 + 5000)).toBe(false);
    expect(shouldRetryCapture(h, 's2', 1000 + 5000)).toBe(true);
    expect(shouldRetryCapture(h, 's', 1000 + HOLD_RETRY_MS)).toBe(true);
  });

  it('inboxSignature berubah saat owner menaruh berkas', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gate-'));
    expect(inboxSignature(dir, 'EDU-9')).toBe('');
    mkdirSync(path.join(dir, 'workspace', 'inbox', 'assets', 'EDU-9'), { recursive: true });
    const empty = inboxSignature(dir, 'EDU-9');
    writeFileSync(path.join(dir, 'workspace', 'inbox', 'assets', 'EDU-9', 'a.png'), 'x');
    expect(inboxSignature(dir, 'EDU-9')).not.toBe(empty);
  });
});

describe('step: hold aset', () => {
  const T0 = 5_000_000;
  const running = () => ({ ...newJob({ masterIssueId: 'm', identifier: 'EDU-9', nowMs: T0 }), phase: 'running', stageIndex: 3, stageStartedMs: T0, lastTickMs: T0 });
  const hold = { status: 'in_review' };
  const out = { ok: false, hold: true, errors: ['DITAHAN ...'] };

  it('hold: tidak ada penolakan/percobaan ulang/blokir, satu pemberitahuan saja, jam tahap tidak berjalan', () => {
    let r = step(running(), { stage: hold, output: out, nowMs: T0 + 60_000 });
    expect(r.actions.map((a) => a.type)).toEqual(['holdAssets']);
    expect(r.job.phase).toBe('running'); expect(r.job.stageStartedMs).toBe(T0 + 60_000);
    r = step(r.job, { stage: hold, output: out, nowMs: T0 + 120_000 });
    expect(r.actions).toEqual([]);
    // lewat batas waktu tahap biasa tetap tidak memblokir selama hold
    r = step(r.job, { stage: hold, output: out, nowMs: T0 + 10 * 60 * 60_000 });
    expect(r.job.phase).toBe('running');
  });

  it('setelah aset lengkap tahap lanjut ke QA dan penanda hold direset', () => {
    let r = step(running(), { stage: hold, output: out, nowMs: T0 + 1000 });
    r = step(r.job, { stage: hold, output: { ok: true, errors: [] }, nowMs: T0 + 2000 });
    expect(r.job.stageIndex).toBe(4); expect(r.job.assetHoldNotified).toBe(false);
    expect(r.actions.at(-1)).toEqual({ type: 'createStage', stage: 'qa' });
  });
});
