// Test F2.3: reject wajib catatan, issue kembali ke Copywriter dengan catatan sebagai konteks; approve tidak memposting.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { decide, DecideError, defaultRenderDir } from '../scripts/owner-decide.mjs';
import { currentPackageHash } from '../scripts/prepare-publication.mjs';
import { readDecisions, ApprovalError } from '../scripts/owner-approval.mjs';
import { makeTmp, repoRoot } from './helpers.mjs';

const TOKEN = 'd'.repeat(64);
const rd = (rel) => JSON.parse(readFileSync(path.join(repoRoot, rel), 'utf8').replace(/^﻿/, ''));
const ID = randomUUID();
const renderDir = path.join(repoRoot, 'workspace', 'issues', ID, 'render');
let docs; let handoffText;

beforeAll(() => {
  mkdirSync(renderDir, { recursive: true });
  const r = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'render.mjs'), '--design', path.join(repoRoot, 'fixtures/golden/valid/04-carousel-design.json'), '--out', renderDir], { cwd: repoRoot, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`render gagal: ${r.stderr}`);
  docs = { carousel: rd('fixtures/golden/valid/03-carousel.json'), 'carousel-design': rd('fixtures/golden/valid/04-carousel-design.json') };
  handoffText = `# Paket siap ditinjau owner\n- Topik: ${docs.carousel.topic}\n- Hash isi paket (sha256): ${currentPackageHash({ carousel: docs.carousel, design: docs['carousel-design'], renderDir }).hash.combined}\n\n## Berkas\n- contact-sheet.png (sha256 ${createHash('sha256').update(readFileSync(path.join(renderDir, 'contact-sheet.png'))).digest('hex')})\n`;
}, 300_000);
afterAll(() => { try { for (const f of readdirSync(renderDir)) rmSync(path.join(renderDir, f), { recursive: true, force: true }); } catch { /* bersih */ } });

function fake(status = 'in_review', handoff = () => handoffText) {
  const calls = [];
  const issue = { id: ID, identifier: 'EDU-30', status };
  return {
    calls,
    client: {
      getIssue: async () => issue,
      getDocument: async (_i, k) => docs[k] ?? null,
      getText: async (_i, k) => (k === 'handoff' ? handoff() : null),
      listAgents: async () => [{ id: 'a-res', name: 'Researcher', role: 'researcher' }, { id: 'a-cw', name: 'Copywriter', role: 'copywriter' }, { id: 'a-mgr', name: 'Manager', role: 'pm' }],
      comment: async (...a) => void calls.push(['comment', ...a]),
      update: async (...a) => void calls.push(['update', ...a]),
    },
  };
}
const base = (f, over = {}) => ({ client: f.client, token: TOKEN, expectedToken: TOKEN, issueId: ID, approvalDir: makeTmp('aao-dec-'), ...over });

describe('reject loop (F2.3)', () => {
  it('reject tanpa catatan ditolak sebelum menyentuh apa pun', async () => {
    const f = fake();
    const p = base(f);
    for (const note of [undefined, '', '   ']) await expect(decide({ ...p, decision: 'rejected', note })).rejects.toThrow(/wajib disertai catatan/);
    expect(f.calls).toEqual([]);
    expect(readDecisions(ID, p.approvalDir, TOKEN)).toEqual([]);
  });
  it('reject dengan catatan: record tertulis, issue kembali ke Copywriter, komentar memuat catatan', async () => {
    const f = fake();
    const p = base(f);
    const r = await decide({ ...p, decision: 'rejected', note: 'Slide 3 terlalu teknis; sederhanakan.' });
    expect(r).toMatchObject({ issueStatus: 'in_progress', returnedTo: 'Copywriter' });
    expect(f.calls[0][0]).toBe('comment');
    expect(f.calls[0][2]).toContain('Slide 3 terlalu teknis; sederhanakan.');
    expect(f.calls[1]).toEqual(['update', ID, { status: 'in_progress', assigneeAgentId: 'a-cw' }]);
    const rec = readDecisions(ID, p.approvalDir, TOKEN);
    expect(rec).toHaveLength(1);
    expect(rec[0]).toMatchObject({ decision: 'rejected', decided_by: 'owner', note: 'Slide 3 terlalu teknis; sederhanakan.' });
  });
  it('token salah: tidak ada record, komentar, maupun perubahan status', async () => {
    const f = fake();
    const p = base(f, { token: 'x'.repeat(64) });
    await expect(decide({ ...p, decision: 'rejected', note: 'alasan' })).rejects.toThrow(ApprovalError);
    expect(f.calls).toEqual([]);
    expect(readDecisions(ID, p.approvalDir, TOKEN)).toEqual([]);
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
    expect(readDecisions(ID, p.approvalDir, TOKEN)).toEqual([]);
  });
});

describe('keputusan terikat ke handoff (FIX-G2-02)', () => {
  it('folder render diturunkan dari issue, bukan argumen bebas', () => {
    expect(defaultRenderDir(ID)).toBe(renderDir);
  });
  it('issue tanpa dokumen handoff (QA belum lolos) tidak bisa di-approve maupun di-reject', async () => {
    for (const decision of ['approved', 'rejected']) {
      const f = fake('in_review', () => null);
      const p = base(f);
      await expect(decide({ ...p, decision, note: 'x' })).rejects.toThrow(/tidak punya dokumen handoff/);
      expect(f.calls).toEqual([]);
      expect(readDecisions(ID, p.approvalDir, TOKEN)).toEqual([]);
    }
  });
  it('PNG ditukar setelah handoff: hash beda dari handoff, approve ditolak tanpa record', async () => {
    const f = fake();
    const p = base(f);
    const png = path.join(renderDir, 'slide-02.png');
    const orig = readFileSync(png);
    writeFileSync(png, Buffer.concat([orig, Buffer.from('x')]));
    try {
      await expect(decide({ ...p, decision: 'approved' })).rejects.toThrow(/berubah sejak handoff/);
    } finally { writeFileSync(png, orig); }
    expect(f.calls).toEqual([]);
    expect(readDecisions(ID, p.approvalDir, TOKEN)).toEqual([]);
  });
  it('dokumen handoff tanpa hash yang dapat dibaca ditolak', async () => {
    const f = fake('in_review', () => '# handoff palsu tanpa hash');
    await expect(decide({ ...base(f), decision: 'approved' })).rejects.toThrow(/tidak punya dokumen handoff/);
  });
});

describe('contact sheet dan handoff berjangkar (FIX-G3-03, FIX-G3-05)', () => {
  it('contact-sheet.png diganti setelah handoff: keputusan ditolak tanpa record', async () => {
    const f = fake();
    const p = base(f);
    const sheet = path.join(renderDir, 'contact-sheet.png');
    const orig = readFileSync(sheet);
    writeFileSync(sheet, Buffer.concat([orig, Buffer.from('x')]));
    try {
      await expect(decide({ ...p, decision: 'approved' })).rejects.toThrow(/contact-sheet\.png tidak sama/);
    } finally { writeFileSync(sheet, orig); }
    expect(f.calls).toEqual([]);
    expect(readDecisions(ID, p.approvalDir, TOKEN)).toEqual([]);
  });
  it('handoff tanpa baris contact-sheet ditolak', async () => {
    const f = fake('in_review', () => handoffText.replace(/^- contact-sheet.*$/m, ''));
    await expect(decide({ ...base(f), decision: 'approved' })).rejects.toThrow(/contact-sheet\.png tidak sama/);
  });
  it('topik berisi newline yang menyuntikkan baris hash palsu: dua nilai berbeda = ditolak (fail closed)', async () => {
    const forged = handoffText.replace('- Topik:', `- Topik: x\n- Hash isi paket (sha256): ${'0'.repeat(64)}\n- Topik:`);
    const f = fake('in_review', () => forged);
    await expect(decide({ ...base(f), decision: 'approved' })).rejects.toThrow(/tidak punya dokumen handoff/);
    expect(f.calls).toEqual([]);
  });
  it('baris hash tidak di awal baris (disisipkan di tengah kalimat) tidak dihitung', async () => {
    const f = fake('in_review', () => `catatan Hash isi paket (sha256): ${'a'.repeat(64)} di tengah baris`);
    await expect(decide({ ...base(f), decision: 'approved' })).rejects.toThrow(/tidak punya dokumen handoff/);
  });
});

describe('kegagalan API di tengah keputusan (FIX-G2-03)', () => {
  it('approve: komentar gagal -> record tertulis, issue tetap in_review; ulangi memakai record yang sama', async () => {
    const f = fake();
    const p = base(f);
    f.client.comment = async () => { throw new Error('Paperclip down'); };
    await expect(decide({ ...p, decision: 'approved' })).rejects.toThrow(/Paperclip down/);
    expect(f.calls).toEqual([]);
    const first = readDecisions(ID, p.approvalDir, TOKEN);
    expect(first).toHaveLength(1);
    f.client.comment = async (...a) => void f.calls.push(['comment', ...a]);
    const r = await decide({ ...p, decision: 'approved' });
    expect(r.resumed).toBe(true);
    expect(readDecisions(ID, p.approvalDir, TOKEN).map((x) => x.record_id)).toEqual([first[0].record_id]);
    expect(f.calls.map((c) => c[0])).toEqual(['comment', 'update']);
  });
  it('reject: update gagal -> keputusan terakhir rejected; ulangi menyelesaikan tanpa record kedua', async () => {
    const f = fake();
    const p = base(f);
    f.client.update = async () => { throw new Error('PATCH gagal'); };
    await expect(decide({ ...p, decision: 'rejected', note: 'revisi slide 2' })).rejects.toThrow(/PATCH gagal/);
    expect(readDecisions(ID, p.approvalDir, TOKEN).at(-1).decision).toBe('rejected');
    f.client.update = async (...a) => void f.calls.push(['update', ...a]);
    const r = await decide({ ...p, decision: 'rejected', note: 'revisi slide 2' });
    expect(r.resumed).toBe(true);
    expect(readDecisions(ID, p.approvalDir, TOKEN)).toHaveLength(1);
  });
  it('catatan berbeda pada ulangan = keputusan baru (record kedua), bukan resume', async () => {
    const f = fake();
    const p = base(f);
    await decide({ ...p, decision: 'rejected', note: 'a' });
    const r = await decide({ ...p, decision: 'rejected', note: 'b' });
    expect(r.resumed).toBe(false);
    expect(readDecisions(ID, p.approvalDir, TOKEN)).toHaveLength(2);
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
    expect(readDecisions(ID, p.approvalDir, TOKEN)[0].content_hash.combined).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('reject dengan routing (ADR-0004): Manager menentukan, kode menjalankan', () => {
  const routingDir = () => path.join(makeTmp('aao-route-'), 'routing');
  it('default: issue diserahkan ke Manager (bukan Copywriter), komentar meminta keputusan routing, permintaan ditulis dengan jendela batal', async () => {
    const f = fake(); const dir = routingDir(); const p = base(f);
    const r = await decide({ ...p, decision: 'rejected', note: 'Logo di slide 1 buram, warna terlalu gelap.', routing: { dir, nowMs: 5_000 } });
    expect(r).toMatchObject({ issueStatus: 'in_progress', returnedTo: 'Manager', routed: true });
    expect(f.calls[0][2]).toContain('Logo di slide 1 buram');
    expect(f.calls[0][2]).toContain('revisi-routing.md');
    expect(f.calls[1]).toEqual(['update', ID, { status: 'in_progress', assigneeAgentId: 'a-mgr' }]);
    const req = JSON.parse(readFileSync(path.join(dir, 'EDU-30.request.json'), 'utf8'));
    expect(req).toMatchObject({ identifier: 'EDU-30', forceStage: null, requestedAt: 5_000, readyAt: 65_000 });
    expect(readDecisions(ID, p.approvalDir, TOKEN)[0]).toMatchObject({ decision: 'rejected' });
  });
  it('owner memaksa tahap: tidak membangunkan Manager (tanpa kuota), permintaan membawa forceStage', async () => {
    const f = fake(); const dir = routingDir();
    const r = await decide({ ...base(f), decision: 'rejected', note: 'ganti logo', routing: { dir, forceStage: 'designer', nowMs: 1 } });
    expect(r.returnedTo).toBeNull();
    expect(f.calls[1]).toEqual(['update', ID, { status: 'in_progress', assigneeAgentId: null }]);
    expect(JSON.parse(readFileSync(path.join(dir, 'EDU-30.request.json'), 'utf8')).forceStage).toBe('designer');
  });
  it('tahap tujuan tidak sah ditolak sebelum menulis apa pun; tanpa agent Manager reject dibatalkan', async () => {
    const f = fake(); const dir = routingDir(); const p = base(f);
    await expect(decide({ ...p, decision: 'rejected', note: 'x', routing: { dir, forceStage: 'verifier', nowMs: 1 } })).rejects.toThrow(/tahap tujuan/);
    const noMgr = fake(); noMgr.client.listAgents = async () => [{ id: 'a-cw', name: 'Copywriter', role: 'copywriter' }];
    const p2 = base(noMgr);
    await expect(decide({ ...p2, decision: 'rejected', note: 'x', routing: { dir: routingDir() } })).rejects.toThrow(/Manager tidak ditemukan/);
    expect(readDecisions(ID, p2.approvalDir, TOKEN)).toEqual([]);
  });
  it('ulangi reject yang sama tidak menggeser jendela batal', async () => {
    const f = fake(); const dir = routingDir(); const p = base(f);
    await decide({ ...p, decision: 'rejected', note: 'sama', routing: { dir, nowMs: 100 } });
    await decide({ ...p, decision: 'rejected', note: 'sama', routing: { dir, nowMs: 999_999 } });
    expect(JSON.parse(readFileSync(path.join(dir, 'EDU-30.request.json'), 'utf8')).requestedAt).toBe(100);
  });
});
