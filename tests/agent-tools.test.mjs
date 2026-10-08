// Test tool agent deterministik (F1.0d) dengan ctx palsu.
import { describe, it, expect } from 'vitest';
import { makeAgentTools, AGENT_ALLOWED_TRANSITIONS, TOOL_DEFS } from '../plugins/aao-approval-gate/src/agent-tools.js';
import manifest from '../plugins/aao-approval-gate/manifest.js';

const ID = '67395162-13fc-4811-aea6-5085c34b59b6';
const run = { companyId: 'co1', agentId: 'ag1', runId: 'r1' };

function fake(status = 'in_progress') {
  const calls = [];
  const ctx = {
    issues: {
      get: async (id, co) => (id === ID && co === 'co1' ? { id, status } : null),
      update: async (...a) => calls.push(['update', ...a]),
      createComment: async (...a) => (calls.push(['comment', ...a]), { id: 'cm1' }),
      documents: { upsert: async (i) => (calls.push(['doc', i]), { id: 'd1' }) },
    },
  };
  return { tools: makeAgentTools(ctx), calls };
}

describe('post_comment', () => {
  it('mengirim komentar panjang non-ASCII tanpa ubah isi, atas nama agent', async () => {
    const { tools, calls } = fake();
    const body = 'Ringkasan “kebijakan” — pekerja di California: ' + 'é日本語 '.repeat(2000);
    const r = await tools.post_comment({ issueId: ID, body }, run);
    expect(r.data.ok).toBe(true);
    expect(calls[0]).toEqual(['comment', ID, body, 'co1', { authorAgentId: 'ag1' }]);
  });
  it('menolak body kosong, issueId bukan UUID, dan issue company lain', async () => {
    const { tools } = fake();
    expect((await tools.post_comment({ issueId: ID, body: '  ' }, run)).data.ok).toBe(false);
    expect((await tools.post_comment({ issueId: 'x', body: 'a' }, run)).data.ok).toBe(false);
    expect((await tools.post_comment({ issueId: ID, body: 'a' }, { ...run, companyId: 'lain' })).data.ok).toBe(false);
  });
});

describe('set_issue_status', () => {
  it('mengizinkan in_progress -> in_review', async () => {
    const { tools, calls } = fake('in_progress');
    const r = await tools.set_issue_status({ issueId: ID, status: 'in_review' }, run);
    expect(r.data).toMatchObject({ ok: true, from: 'in_progress', to: 'in_review' });
    expect(calls[0]).toEqual(['update', ID, { status: 'in_review' }, 'co1']);
  });
  it('menolak done dan cancelled dari status mana pun', async () => {
    for (const from of Object.keys(AGENT_ALLOWED_TRANSITIONS)) {
      for (const to of ['done', 'cancelled']) {
        const { tools, calls } = fake(from);
        const r = await tools.set_issue_status({ issueId: ID, status: to }, run);
        expect(r.data.ok, `${from}->${to}`).toBe(false);
        expect(calls).toHaveLength(0);
      }
    }
  });
  it('menolak transisi dari status akhir', async () => {
    const { tools } = fake('done');
    expect((await tools.set_issue_status({ issueId: ID, status: 'in_progress' }, run)).data.ok).toBe(false);
  });
});

describe('attach_file', () => {
  it('menyimpan dokumen dengan key valid', async () => {
    const { tools, calls } = fake();
    const r = await tools.attach_file({ issueId: ID, key: 'research-output', body: '{"a":"é"}' }, run);
    expect(r.data).toMatchObject({ ok: true, key: 'research-output' });
    expect(calls[0][1]).toMatchObject({ issueId: ID, companyId: 'co1', format: 'markdown' });
  });
  it('menolak key berbahaya (path traversal / huruf besar)', async () => {
    const { tools } = fake();
    for (const key of ['../x', 'A', 'a.json', '', 'a/b']) {
      expect((await tools.attach_file({ issueId: ID, key, body: 'x' }, run)).data.ok).toBe(false);
    }
  });
});

describe('galat dari Paperclip', () => {
  it('dikembalikan sebagai ok:false, bukan exception', async () => {
    const ctx = { issues: { get: async () => ({ id: ID, status: 'todo' }), update: async () => { throw new Error('in_progress issues require an assignee'); } } };
    const r = await makeAgentTools(ctx).set_issue_status({ issueId: ID, status: 'in_progress' }, run);
    expect(r.data.ok).toBe(false);
    expect(r.data.error).toMatch(/assignee/);
  });
});

describe('manifest', () => {
  it('mendeklarasikan semua tool dan capability yang dipakai', () => {
    const names = manifest.tools.map((t) => t.name);
    for (const n of Object.keys(TOOL_DEFS)) expect(names).toContain(n);
    for (const c of ['agent.tools.register', 'issues.read', 'issues.update', 'issue.comments.create', 'issue.documents.write'])
      expect(manifest.capabilities).toContain(c);
  });
});
