// Test F2.3: reject wajib catatan, issue kembali ke Copywriter dengan catatan sebagai konteks; approve tidak memposting.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { decide, DecideError } from '../scripts/owner-decide.mjs';
import { readDecisions, ApprovalError } from '../scripts/owner-approval.mjs';
import { makeTmp, repoRoot } from './helpers.mjs';

const TOKEN = 'd'.repeat(64);
const rd = (rel) => JSON.parse(readFileSync(path.join(repoRoot, rel), 'utf8').replace(/^﻿/, ''));
const ID = randomUUID();
const renderDir = path.join(repoRoot, 'workspace', 'issues', ID, 'render');
let docs;

beforeAll(() => {
  mkdirSync(renderDir, { recursive: true });
  const r = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'render.mjs'), '--design', path.join(repoRoot, 'fixtures/golden/valid/04-carousel-design.json'), '--out', renderDir], { cwd: repoRoot, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`render gagal: ${r.stderr}`);
  docs = { carousel: rd('fixtures/golden/valid/03-carousel.json'), 'carousel-design': rd('fixtures/golden/valid/04-carousel-design.json') };
}, 120_000);
afterAll(() => { try { for (const f of readdirSync(renderDir)) rmSync(path.join(renderDir, f), { recursive: true, force: true }); } catch { /* bersih */ } });

function fake(status = 'in_review') {
  const calls = [];
  const issue = { id: ID, identifier: 'EDU-30', status };
  return {
    calls,
    client: {
      getIssue: async () => issue,
      getDocument: async (_i, k) => docs[k] ?? null,
      listAgents: async () => [{ id: 'a-res', name: 'Researcher', role: 'researcher' }, { id: 'a-cw', name: 'Copywriter', role: 'copywriter' }],
      comment: async (...a) => void calls.push(['comment', ...a]),
      update: async (...a) => void calls.push(['update', ...a]),
    },
  };
}
const base = (f, over = {}) => ({ client: f.client, token: TOKEN, expectedToken: TOKEN, issueId: ID, renderDir, approvalDir: makeTmp('aao-dec-'), ...over });

describe('reject loop (F2.3)', () => {
  it('reject tanpa catatan ditolak sebelum menyentuh apa pun', async () => {
    const f = fake();
    const p = base(f);
    for (const note of [undefined, '', '   ']) await expect(decide({ ...p, decision: 'rejected', note })).rejects.toThrow(/wajib disertai catatan/);
    expect(f.calls).toEqual([]);
    expect(readDecisions(ID, p.approvalDir)).toEqual([]);
  });
  it('reject dengan catatan: record tertulis, issue kembali ke Copywriter, komentar memuat catatan', async () => {
    const f = fake();
    const p = base(f);
    const r = await decide({ ...p, decision: 'rejected', note: 'Slide 3 terlalu teknis; sederhanakan.' });
    expect(r).toMatchObject({ issueStatus: 'in_progress', returnedTo: 'Copywriter' });
    expect(f.calls[0][0]).toBe('comment');
    expect(f.calls[0][2]).toContain('Slide 3 terlalu teknis; sederhanakan.');
    expect(f.calls[1]).toEqual(['update', ID, { status: 'in_progress', assigneeAgentId: 'a-cw' }]);
    const rec = readDecisions(ID, p.approvalDir);
    expect(rec).toHaveLength(1);
    expect(rec[0]).toMatchObject({ decision: 'rejected', decided_by: 'owner', note: 'Slide 3 terlalu teknis; sederhanakan.' });
  });
  it('token salah: tidak ada record, komentar, maupun perubahan status', async () => {
    const f = fake();
    const p = base(f, { token: 'x'.repeat(64) });
    await expect(decide({ ...p, decision: 'rejected', note: 'alasan' })).rejects.toThrow(ApprovalError);
    expect(f.calls).toEqual([]);
    expect(readDecisions(ID, p.approvalDir)).toEqual([]);
  });
  it('issue bukan in_review ditolak', async () => {
    const f = fake('in_progress');
    await expect(decide({ ...base(f), decision: 'rejected', note: 'x' })).rejects.toThrow(DecideError);
    expect(f.calls).toEqual([]);
  });
  it('tanpa agent Copywriter: dibatalkan sebelum record ditulis', async () => {
    const f = fake();
    f.client.listAgents = async () => [{ id: 'a1', name: 'QA', role: 'qa' }];
    const p = base(f);
    await expect(decide({ ...p, decision: 'rejected', note: 'x' })).rejects.toThrow(/Copywriter/);
    expect(readDecisions(ID, p.approvalDir)).toEqual([]);
  });
});

describe('approve', () => {
  it('approve: record approved terikat hash, issue done, tidak ada posting', async () => {
    const f = fake();
    const p = base(f);
    const r = await decide({ ...p, decision: 'approved' });
    expect(r.issueStatus).toBe('done');
    expect(f.calls.map((c) => c[0])).toEqual(['comment', 'update']);
    expect(f.calls[1][2]).toEqual({ status: 'done' });
    expect(readDecisions(ID, p.approvalDir)[0].content_hash.combined).toMatch(/^[0-9a-f]{64}$/);
  });
});
