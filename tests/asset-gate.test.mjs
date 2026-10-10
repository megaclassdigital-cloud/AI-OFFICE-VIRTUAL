import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { imageSlotsUsed, matchRequests, manifestVerdict, holdMessage, inboxSignature, shouldRetryCapture, HOLD_RETRY_MS, checkAssets } from '../scripts/asset-gate.mjs';
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

describe('checkAssets (pemeriksaan ketat aset)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'chk-'));
  mkdirSync(path.join(dir, 'workspace', 'agent', 'runs', 'EDU-9', 'assets'), { recursive: true });
  writeFileSync(path.join(dir, 'workspace', 'agent', 'runs', 'EDU-9', 'assets', 'claude-logo.png'), Buffer.alloc(5000, 1));
  const run = (manifest, carousel = null, d = design) => checkAssets({ design: d, templates, manifest, identifier: 'EDU-9', carousel, rootDir: dir });
  const goodLogo = { file: 'claude-logo.png', kind: 'brand', brand: 'Claude', query: 'Claude Anthropic', status: 'captured', title: 'File:Claude AI symbol.svg - Wikimedia Commons', imageUrl: 'https://x/a.png' };

  it('logo asli dengan bukti judul lolos', () => { expect(run({ assets: [goodLogo] })).toEqual([]); });
  it('aset tidak tercatat, blocked, atau berkas hilang ditolak', () => {
    expect(run({ assets: [] }).join()).toMatch(/slide 1: gambar "claude-logo.png" belum asli \(status tidak tercatat\)/);
    expect(run({ assets: [{ ...goodLogo, status: 'blocked' }] }).join()).toMatch(/status blocked/);
    const noFile = checkAssets({ design, templates, manifest: { assets: [goodLogo] }, identifier: 'EDU-9', rootDir: mkdtempSync(path.join(tmpdir(), 'chk2-')) });
    expect(noFile.join()).toMatch(/tidak ada atau terlalu kecil/);
  });
  it('logo tanpa bukti merek ditolak (judul tidak memuat merek, atau tanpa judul)', () => {
    expect(run({ assets: [{ ...goodLogo, title: 'Gemini logo official' }] }).join()).toMatch(/tidak terbukti milik merek "Claude"/);
    expect(run({ assets: [{ ...goodLogo, title: undefined }] }).join()).toMatch(/tanpa bukti judul/);
    expect(run({ assets: [{ ...goodLogo, status: 'owner-supplied', title: undefined }] })).toEqual([]);
  });
  it('saran visual menyebut logo tetapi aset bertipe foto ditolak', () => {
    const car = { slides: [{ index: 1, visualIdea: 'logo Claude' }] };
    expect(run({ assets: [{ ...goodLogo, kind: 'photo', status: 'owner-supplied' }] }, car).join()).toMatch(/minta kind "brand"/);
  });
  it('placeholder tata letak di brand/ ditolak', () => {
    const d = { slides: [{ index: 2, template: 'hero-cover', slots: { hero: 'brand/hero-1.png', title: 'y' } }] };
    expect(run({ assets: [] }, null, d).join()).toMatch(/placeholder/);
  });
});

describe('status kept tidak diterima tanpa bukti', () => {
  it('manifestVerdict menolak kept', () => {
    expect(manifestVerdict({ assets: [{ file: 'a.png', status: 'kept' }] }, ['a.png']).complete).toBe(false);
  });
});

describe('pemakaian ulang logo merek di slide lain', () => {
  it('logo merek boleh dipakai di sampul dan CTA dengan satu permintaan; aset non-merek tetap harus cocok slide', async () => {
    const { matchRequests } = await import('../scripts/asset-gate.mjs');
    const used = [{ slide: 1, file: 'logo.png' }, { slide: 6, file: 'logo.png' }];
    expect(matchRequests(used, { requests: [{ slide: 1, file: 'logo.png', kind: 'brand' }] })).toEqual([]);
    expect(matchRequests(used, { requests: [{ slide: 1, file: 'logo.png', kind: 'product' }] })).toHaveLength(1);
  });
});
