// Test state machine siklus hidup issue (F1.0e).
import { describe, it, expect } from 'vitest';
import { canTransition, allowedFrom, isAgentIdleState, DOMAIN_STATE } from '../plugins/aao-approval-gate/src/lifecycle.js';
import { makeAgentTools } from '../plugins/aao-approval-gate/src/agent-tools.js';

const ID = '67395162-13fc-4811-aea6-5085c34b59b6';
const run = { companyId: 'co1', agentId: 'ag1', runId: 'r1' };
const STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled'];

describe('state machine', () => {
  it('agent tidak pernah boleh ke done/cancelled dari status mana pun', () => {
    for (const from of STATUSES) for (const to of ['done', 'cancelled']) expect(canTransition('agent', from, to)).toBe(false);
  });
  it('owner boleh menyetujui (in_review -> done) dan menolak (-> cancelled)', () => {
    expect(canTransition('owner', 'in_review', 'done')).toBe(true);
    expect(canTransition('owner', 'in_review', 'cancelled')).toBe(true);
  });
  it('status akhir tidak punya transisi keluar untuk siapa pun', () => {
    for (const a of ['agent', 'owner']) for (const f of ['done', 'cancelled']) expect(allowedFrom(a, f)).toEqual([]);
  });
  it('owner tidak bisa melompat todo -> done tanpa tinjauan', () => {
    expect(canTransition('owner', 'todo', 'done')).toBe(false);
  });
  it('pemetaan state domain ke status Paperclip', () => {
    expect(DOMAIN_STATE).toMatchObject({ awaiting_approval: 'in_review', needs_human: 'blocked' });
  });
  it('status idle: tidak ada pekerjaan agent tersisa', () => {
    for (const s of ['in_review', 'blocked', 'done', 'cancelled']) expect(isAgentIdleState(s)).toBe(true);
    for (const s of ['todo', 'in_progress']) expect(isAgentIdleState(s)).toBe(false);
  });
});

describe('complete_stage', () => {
  function fake(status) {
    const calls = [];
    return {
      calls,
      tools: makeAgentTools({
        issues: {
          get: async () => ({ id: ID, status }),
          update: async (...a) => calls.push(['update', ...a]),
          createComment: async (...a) => (calls.push(['comment', ...a]), { id: 'c1' }),
        },
      }),
    };
  }
  it('menulis komentar lalu menyetel in_review', async () => {
    const { tools, calls } = fake('in_progress');
    const r = await tools.complete_stage({ issueId: ID, outcome: 'awaiting_approval', summary: 'Selesai — 6 kandidat.' }, run);
    expect(r.data).toMatchObject({ ok: true, from: 'in_progress', to: 'in_review' });
    expect(calls.map((c) => c[0])).toEqual(['comment', 'update']);
  });
  it('needs_human menyetel blocked', async () => {
    const { tools } = fake('in_progress');
    expect((await tools.complete_stage({ issueId: ID, outcome: 'needs_human', summary: 'Butuh keputusan.' }, run)).data.to).toBe('blocked');
  });
  it('ditolak tanpa efek bila status tidak mengizinkan atau outcome salah', async () => {
    const a = fake('done');
    expect((await a.tools.complete_stage({ issueId: ID, outcome: 'awaiting_approval', summary: 'x' }, run)).data.ok).toBe(false);
    expect(a.calls).toHaveLength(0);
    const b = fake('in_progress');
    expect((await b.tools.complete_stage({ issueId: ID, outcome: 'approved', summary: 'x' }, run)).data.ok).toBe(false);
    expect(b.calls).toHaveLength(0);
  });
});
