// Test handoff ke owner (F1.10): hanya setelah QA lolos dan isi tidak berubah; agent tidak bisa approve.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { makeAgentTools } from '../plugins/aao-approval-gate/src/agent-tools.js';
import { canonicalJson, packageContentHash, sha256 } from '../plugins/aao-approval-gate/src/content-hash.js';
import { validate } from '../schemas/validate.mjs';
import { repoRoot } from './helpers.mjs';

const read = (rel) => JSON.parse(readFileSync(path.join(repoRoot, rel), 'utf8').replace(/^﻿/, ''));
const clone = (o) => JSON.parse(JSON.stringify(o));
const ISSUE = randomUUID();
const renderDir = path.join(repoRoot, 'workspace', 'issues', ISSUE, 'render');
const run = { companyId: 'co1', agentId: 'qa1', runId: 'r1' };
const OK = { llm: { textOk: true, designOk: true } };
let docs0;
let hashes0;

beforeAll(() => {
  mkdirSync(renderDir, { recursive: true });
  const r = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'render.mjs'), '--design', path.join(repoRoot, 'fixtures', 'golden', 'valid', '04-carousel-design.json'), '--out', renderDir], { cwd: repoRoot, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`render golden gagal: ${r.stderr}`);
  hashes0 = readFileSync(path.join(renderDir, 'hashes.json'), 'utf8');
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
  const written = {};
  const calls = [];
  const issue = { id: ISSUE, status };
  const key = (k) => `${k.scopeId}/${k.namespace}/${k.stateKey}`;
  return {
    issue, calls, written, state,
    ctx: {
      state: { get: async (k) => state.get(key(k)) ?? null, set: async (k, v) => void state.set(key(k), v) },
      issues: {
        get: async () => issue,
        update: async (...a) => { calls.push(['update', ...a]); issue.status = a[1].status; },
        createComment: async (...a) => (calls.push(['comment', ...a]), { id: 'c1' }),
        documents: {
          get: async (_i, k) => (docs[k] ? { body: JSON.stringify(docs[k]) } : null),
          upsert: async (d) => { written[d.key] = d; return { id: 'd1' }; },
        },
      },
    },
  };
}

describe('content-hash', () => {
  it('canonicalJson tidak bergantung pada urutan kunci', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }));
  });
  it('hash paket berubah bila teks atau satu PNG berubah, dan cocok dengan skema approval-record', () => {
    const h = JSON.parse(hashes0);
    const base = packageContentHash({ carousel: docs0.carousel, design: docs0['carousel-design'] }, h);
    const t = clone(docs0.carousel); t.caption += ' ';
    expect(packageContentHash({ carousel: t, design: docs0['carousel-design'] }, h).combined).not.toBe(base.combined);
    expect(packageContentHash({ carousel: docs0.carousel, design: docs0['carousel-design'] }, { ...h, 'slide-01.png': sha256('lain') }).combined).not.toBe(base.combined);
    const rec = { schema_version: 1, record_id: randomUUID(), issue_id: ISSUE, issue_identifier: 'EDU-1', decision: 'approved', decided_at: new Date().toISOString(), decided_by: 'owner', content_hash: base };
    expect(validate('approval-record', rec).errors).toEqual([]);
  });
});

describe('handoff_to_owner', () => {
  it('QA pass lalu handoff: dokumen handoff ditulis, komentar diposting, status in_review', async () => {
    const f = fakeCtx(docs0);
    const t = makeAgentTools(f.ctx);
    expect((await t.qa_submit_result({ issueId: ISSUE, ...OK }, run)).data.action).toBe('pass');
    const r = await t.handoff_to_owner({ issueId: ISSUE }, run);
    expect(r.data).toMatchObject({ ok: true, status: 'in_review', files: 6 });
    expect(f.issue.status).toBe('in_review');
    const doc = f.written.handoff;
    expect(doc.format).toBe('markdown');
    expect(doc.body).toContain(r.data.contentHash);
    expect(doc.body).toMatch(/contact-sheet\.png \(sha256 [0-9a-f]{64}\)/);
    expect(doc.body).toMatch(/slide-06\.png/);
    expect(doc.body).toMatch(/hanya milik owner/);
    expect(f.calls.some((c) => c[0] === 'comment' && /menunggu keputusan owner/.test(c[2]))).toBe(true);
  });

  it('tanpa QA lolos: ditolak, status tidak berubah', async () => {
    const f = fakeCtx(docs0);
    const r = await makeAgentTools(f.ctx).handoff_to_owner({ issueId: ISSUE }, run);
    expect(r.data).toMatchObject({ ok: false });
    expect(r.data.error).toMatch(/QA belum meloloskan/);
    expect(f.issue.status).toBe('in_progress');
  });

  it('QA gagal: ditolak', async () => {
    const bad = clone(docs0);
    bad.carousel.slides[1].body = 'Sebanyak 87 persen perusahaan sudah memakainya.';
    bad.carousel.slides[1].emphasis = [];
    const f = fakeCtx(bad);
    const t = makeAgentTools(f.ctx);
    expect((await t.qa_submit_result({ issueId: ISSUE, ...OK }, run)).data.action).toBe('return_to_copywriter');
    expect((await t.handoff_to_owner({ issueId: ISSUE }, run)).data.ok).toBe(false);
    expect(f.written.handoff).toBeUndefined();
  });

  it('isi paket diubah SETELAH QA lolos: handoff ditolak', async () => {
    const docs = clone(docs0);
    const f = fakeCtx(docs);
    const t = makeAgentTools(f.ctx);
    expect((await t.qa_submit_result({ issueId: ISSUE, ...OK }, run)).data.action).toBe('pass');
    docs.carousel.caption += ' (diubah diam-diam)';
    const r = await t.handoff_to_owner({ issueId: ISSUE }, run);
    expect(r.data.error).toMatch(/isi paket berubah/);
    expect(f.issue.status).toBe('in_progress');
  });

  it('hashes.json renderer diubah setelah QA lolos: handoff ditolak', async () => {
    const f = fakeCtx(docs0);
    const t = makeAgentTools(f.ctx);
    expect((await t.qa_submit_result({ issueId: ISSUE, ...OK }, run)).data.action).toBe('pass');
    const h = JSON.parse(hashes0);
    h['slide-02.png'] = sha256('palsu');
    writeFileSync(path.join(renderDir, 'hashes.json'), JSON.stringify(h), 'utf8');
    try {
      expect((await t.handoff_to_owner({ issueId: ISSUE }, run)).data.error).toMatch(/isi paket berubah/);
    } finally {
      writeFileSync(path.join(renderDir, 'hashes.json'), hashes0, 'utf8');
    }
  });

  it('handoff kedua (sudah in_review) ditolak', async () => {
    const f = fakeCtx(docs0);
    const t = makeAgentTools(f.ctx);
    await t.qa_submit_result({ issueId: ISSUE, ...OK }, run);
    expect((await t.handoff_to_owner({ issueId: ISSUE }, run)).data.ok).toBe(true);
    expect((await t.handoff_to_owner({ issueId: ISSUE }, run)).data.ok).toBe(false);
  });
});

describe('agent tidak bisa menyetujui', () => {
  it('set_issue_status ke approved/done/cancelled ditolak dari in_review maupun in_progress', async () => {
    for (const from of ['in_progress', 'in_review']) {
      const f = fakeCtx(docs0, from);
      const t = makeAgentTools(f.ctx);
      for (const to of ['approved', 'done', 'cancelled']) {
        const r = await t.set_issue_status({ issueId: ISSUE, status: to }, run);
        expect(r.data.ok, `${from}->${to}`).toBe(false);
      }
      expect(f.calls.filter((c) => c[0] === 'update')).toEqual([]);
    }
  });
  it('complete_stage dengan outcome approved ditolak', async () => {
    const f = fakeCtx(docs0);
    expect((await makeAgentTools(f.ctx).complete_stage({ issueId: ISSUE, outcome: 'approved', summary: 'lolos' }, run)).data.ok).toBe(false);
    expect(f.calls).toEqual([]);
  });
  it('tidak ada tool yang menyetel status akhir: daftar tool tidak memuat approve/publish', () => {
    const names = Object.keys(makeAgentTools({}));
    expect(names.filter((n) => /approve|publish|prepare_publication/i.test(n))).toEqual([]);
  });
});
