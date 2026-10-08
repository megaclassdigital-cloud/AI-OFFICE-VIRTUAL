// Test routing QA dan penghitung putaran (F1.9b, AC1.4).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { decide, combineVerdict, MAX_ROUNDS } from '../plugins/aao-approval-gate/src/qa-routing.js';
import { makeAgentTools } from '../plugins/aao-approval-gate/src/agent-tools.js';
import { repoRoot } from './helpers.mjs';

describe('decide: putaran per jalur', () => {
  const R0 = { text: 0, design: 0 };
  it('lolos -> pass, hitungan tidak berubah', () => {
    expect(decide(R0, { failedText: false, failedDesign: false })).toMatchObject({ action: 'pass', rounds: R0 });
  });
  it('AC1.4: gagal teks 3 kali -> putaran 1, putaran 2, lalu needs_human', () => {
    const a = decide(R0, { failedText: true, failedDesign: false });
    const b = decide(a.rounds, { failedText: true, failedDesign: false });
    const c = decide(b.rounds, { failedText: true, failedDesign: false });
    expect([a.action, b.action, c.action]).toEqual(['return_to_copywriter', 'return_to_copywriter', 'needs_human']);
    expect(c.rounds).toEqual({ text: MAX_ROUNDS, design: 0 });
  });
  it('AC1.4: gagal visual 3 kali -> designer, designer, needs_human', () => {
    let r = R0;
    const acts = [];
    for (let i = 0; i < 3; i++) { const d = decide(r, { failedText: false, failedDesign: true }); acts.push(d.action); r = d.rounds; }
    expect(acts).toEqual(['return_to_designer', 'return_to_designer', 'needs_human']);
  });
  it('jalur teks dan desain dihitung terpisah', () => {
    const t = decide(R0, { failedText: true, failedDesign: false });
    const d = decide(t.rounds, { failedText: false, failedDesign: true });
    expect(d).toMatchObject({ action: 'return_to_designer', rounds: { text: 1, design: 1 } });
  });
  it('teks dan desain gagal bersamaan: teks lebih dulu, hitungan desain tidak bertambah', () => {
    expect(decide(R0, { failedText: true, failedDesign: true })).toMatchObject({ action: 'return_to_copywriter', rounds: { text: 1, design: 0 } });
  });
  it('batas putaran dapat diatur', () => {
    expect(decide({ text: 1, design: 0 }, { failedText: true, failedDesign: false }, 1).action).toBe('needs_human');
  });
});

describe('combineVerdict: LLM hanya bisa menambah kegagalan', () => {
  const det = (t, d, v) => ({ summary: { failedText: t, failedDesign: d, failedVisual: v } });
  it('LLM mengatakan ok tetapi cek deterministik gagal -> tetap gagal', () => {
    expect(combineVerdict(det(true, false, false), { textOk: true, designOk: true })).toEqual({ failedText: true, failedDesign: false });
    expect(combineVerdict(det(false, false, true), { textOk: true, designOk: true })).toEqual({ failedText: false, failedDesign: true });
  });
  it('LLM menggagalkan padahal deterministik lolos -> gagal', () => {
    expect(combineVerdict(det(false, false, false), { textOk: false, designOk: true })).toEqual({ failedText: true, failedDesign: false });
  });
  it('tanpa penilaian LLM, hasil deterministik berlaku', () => {
    expect(combineVerdict(det(false, false, false), undefined)).toEqual({ failedText: false, failedDesign: false });
  });
});

// ── Tool qa_submit_result dengan ctx palsu + laporan visual NYATA dari renderer ──
const read = (rel) => JSON.parse(readFileSync(path.join(repoRoot, rel), 'utf8').replace(/^﻿/, ''));
const ISSUE = randomUUID();
const renderDir = path.join(repoRoot, 'workspace', 'issues', ISSUE, 'render');
const run = { companyId: 'co1', agentId: 'qa1', runId: 'r1' };
let docs0;

beforeAll(() => {
  mkdirSync(renderDir, { recursive: true });
  const r = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'render.mjs'), '--design', path.join(repoRoot, 'fixtures', 'golden', 'valid', '04-carousel-design.json'), '--out', renderDir], { cwd: repoRoot, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`render golden gagal: ${r.stderr}`);
  docs0 = {
    carousel: read('fixtures/golden/valid/03-carousel.json'),
    'verification-result': read('fixtures/golden/valid/02-verification-result.json'),
    'carousel-design': read('fixtures/golden/valid/04-carousel-design.json'),
    'research-output': read('fixtures/golden/valid/01-research-output.json'),
  };
}, 120_000);

afterAll(() => {
  try { for (const f of readdirSync(renderDir)) rmSync(path.join(renderDir, f), { recursive: true, force: true }); } catch { /* bersih */ }
});

function fakeCtx(docs, status = 'in_progress') {
  const state = new Map();
  const calls = [];
  const issue = { id: ISSUE, status };
  const ctx = {
    state: {
      get: async (k) => state.get(`${k.scopeId}/${k.namespace}/${k.stateKey}`) ?? null,
      set: async (k, v) => void state.set(`${k.scopeId}/${k.namespace}/${k.stateKey}`, v),
    },
    issues: {
      get: async () => issue,
      update: async (...a) => { calls.push(['update', ...a]); issue.status = a[1].status; },
      createComment: async (...a) => (calls.push(['comment', ...a]), { id: 'c1' }),
      documents: { get: async (_i, key) => (docs[key] ? { body: JSON.stringify(docs[key]) } : null) },
    },
  };
  return { ctx, calls, state, issue };
}
const clone = (o) => JSON.parse(JSON.stringify(o));

describe('tool qa_submit_result', () => {
  it('paket valid + LLM ok -> pass, tanpa putaran dan tanpa mengubah status', async () => {
    const { ctx, calls, issue } = fakeCtx(docs0);
    const r = await makeAgentTools(ctx).qa_submit_result({ issueId: ISSUE, llm: { textOk: true, designOk: true } }, run);
    expect(r.data).toMatchObject({ ok: true, action: 'pass', rounds: { text: 0, design: 0 } });
    expect(calls.filter((c) => c[0] === 'update')).toEqual([]);
    expect(issue.status).toBe('in_progress');
  });

  it('AC1.4 end-to-end: teks gagal 3 kali -> copywriter, copywriter, needs_human + issue blocked; penghitung tersimpan di plugin', async () => {
    const bad = clone(docs0);
    bad.carousel.slides[1].body = 'Sebanyak 87 persen perusahaan sudah memakainya.';
    bad.carousel.slides[1].emphasis = [];
    const { ctx, calls, state, issue } = fakeCtx(bad);
    const t = makeAgentTools(ctx);
    const actions = [];
    for (let i = 0; i < 3; i++) actions.push((await t.qa_submit_result({ issueId: ISSUE, llm: { textOk: true, designOk: true } }, run)).data.action);
    expect(actions).toEqual(['return_to_copywriter', 'return_to_copywriter', 'needs_human']);
    expect(issue.status).toBe('blocked');
    expect(state.get(`${ISSUE}/aao-qa/rounds`)).toEqual({ text: 2, design: 0 });
    expect(state.get(`${ISSUE}/aao-qa/verdict`)).toMatchObject({ action: 'needs_human', contentHash: null });
    expect(calls.filter((c) => c[0] === 'comment')).toHaveLength(3);
    expect(calls.find((c) => c[0] === 'comment')[2]).toMatch(/slide 2: .*angka "87"/);
  });

  it('LLM mengatakan semua ok tetapi cek deterministik gagal -> tidak bisa diloloskan', async () => {
    const bad = clone(docs0);
    bad.carousel.sources[0] = { candidateId: 'c06', url: bad['verification-result'].results[5].url, source_name: 'AP' };
    const { ctx } = fakeCtx(bad);
    const r = await makeAgentTools(ctx).qa_submit_result({ issueId: ISSUE, llm: { textOk: true, designOk: true } }, run);
    expect(r.data.action).toBe('return_to_copywriter');
    expect(r.data.passedDeterministic).toBe(false);
  });

  it('LLM menggagalkan desain padahal deterministik lolos -> kembali ke designer', async () => {
    const { ctx } = fakeCtx(docs0);
    const r = await makeAgentTools(ctx).qa_submit_result({ issueId: ISSUE, llm: { textOk: true, designOk: false, notes: [{ slide: 3, note: 'Kontras terasa rendah' }] } }, run);
    expect(r.data.action).toBe('return_to_designer');
  });

  it('dokumen belum terlampir -> ok:false dengan pesan jelas', async () => {
    const partial = clone(docs0);
    delete partial['carousel-design'];
    const { ctx } = fakeCtx(partial);
    const r = await makeAgentTools(ctx).qa_submit_result({ issueId: ISSUE, llm: { textOk: true, designOk: true } }, run);
    expect(r.data).toMatchObject({ ok: false });
    expect(r.data.error).toMatch(/carousel-design/);
  });

  it('laporan render belum ada -> ok:false', async () => {
    const { ctx } = fakeCtx(docs0);
    const other = randomUUID();
    ctx.issues.get = async () => ({ id: other, status: 'in_progress' });
    const r = await makeAgentTools(ctx).qa_submit_result({ issueId: other, llm: { textOk: true, designOk: true } }, run);
    expect(r.data.error).toMatch(/render_carousel/);
  });
});
