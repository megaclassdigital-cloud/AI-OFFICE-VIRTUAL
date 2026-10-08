// Test F2.1: record approval hanya dengan token owner, tervalidasi, append-only; agent tidak punya jalur menulisnya.
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { recordDecision, readDecisions, latestDecision, initOwnerToken, readOwnerToken, ApprovalError } from '../scripts/owner-approval.mjs';
import { TOOL_DEFS, makeAgentTools } from '../plugins/aao-approval-gate/src/agent-tools.js';
import { sha256 } from '../plugins/aao-approval-gate/src/content-hash.js';
import { makeTmp, repoRoot } from './helpers.mjs';

const TOKEN = 'a'.repeat(64);
const hash = { algorithm: 'sha256', combined: sha256('c'), text: sha256('t'), files: [{ path: 'slide-01.png', sha256: sha256('p') }] };
const mk = () => ({ dir: makeTmp('aao-appr-'), issue: { id: randomUUID(), identifier: 'EDU-12' } });

describe('token owner', () => {
  it('init membuat token 64 hex di .env sekali saja', () => {
    const f = path.join(makeTmp(), '.env');
    expect(initOwnerToken(f).created).toBe(true);
    const t = readOwnerToken(f);
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(initOwnerToken(f).created).toBe(false);
    expect(readOwnerToken(f)).toBe(t);
  });
});

describe('recordDecision', () => {
  it('approve dengan token benar menulis satu berkas valid yang terikat hash', () => {
    const { dir, issue } = mk();
    const r = recordDecision({ token: TOKEN, expectedToken: TOKEN, issue, decision: 'approved', contentHash: hash, dir });
    expect(r).toMatchObject({ decided_by: 'owner', decision: 'approved', issue_id: issue.id, content_hash: hash });
    expect(readdirSync(path.join(dir, issue.id))).toHaveLength(1);
    expect(latestDecision(issue.id, dir).record_id).toBe(r.record_id);
  });
  it('token salah, kosong, atau pendek ditolak dan tidak menulis apa pun', () => {
    const { dir, issue } = mk();
    for (const token of ['b'.repeat(64), '', undefined, 'pendek']) {
      expect(() => recordDecision({ token, expectedToken: TOKEN, issue, decision: 'approved', contentHash: hash, dir })).toThrow(ApprovalError);
    }
    expect(existsSync(path.join(dir, issue.id))).toBe(false);
  });
  it('tanpa token owner terkonfigurasi, semua keputusan ditolak', () => {
    const { dir, issue } = mk();
    expect(() => recordDecision({ token: '', expectedToken: null, issue, decision: 'approved', contentHash: hash, dir })).toThrow(/belum dibuat/);
  });
  it('reject wajib catatan; approve boleh tanpa catatan', () => {
    const { dir, issue } = mk();
    expect(() => recordDecision({ token: TOKEN, expectedToken: TOKEN, issue, decision: 'rejected', contentHash: hash, dir })).toThrow(/tidak valid/);
    expect(() => recordDecision({ token: TOKEN, expectedToken: TOKEN, issue, decision: 'rejected', note: '   ', contentHash: hash, dir })).toThrow(/tidak valid/);
    expect(recordDecision({ token: TOKEN, expectedToken: TOKEN, issue, decision: 'rejected', note: 'Judul slide 1 terlalu panjang', contentHash: hash, dir }).decision).toBe('rejected');
  });
  it('hash tidak valid atau keputusan di luar enum ditolak', () => {
    const { dir, issue } = mk();
    expect(() => recordDecision({ token: TOKEN, expectedToken: TOKEN, issue, decision: 'approved', contentHash: { ...hash, combined: 'xyz' }, dir })).toThrow(/tidak valid/);
    expect(() => recordDecision({ token: TOKEN, expectedToken: TOKEN, issue, decision: 'published', contentHash: hash, dir })).toThrow(/tidak valid/);
  });
  it('append-only: dua keputusan = dua berkas, yang terbaru terbaca terakhir, berkas lama tidak berubah', () => {
    const { dir, issue } = mk();
    const t0 = new Date('2026-10-08T10:00:00Z');
    const a = recordDecision({ token: TOKEN, expectedToken: TOKEN, issue, decision: 'rejected', note: 'revisi', contentHash: hash, dir, now: t0 });
    const first = readFileSync(path.join(dir, issue.id, readdirSync(path.join(dir, issue.id))[0]), 'utf8');
    const b = recordDecision({ token: TOKEN, expectedToken: TOKEN, issue, decision: 'approved', contentHash: hash, dir, now: new Date(t0.getTime() + 60_000) });
    expect(readDecisions(issue.id, dir).map((r) => r.record_id)).toEqual([a.record_id, b.record_id]);
    expect(readFileSync(path.join(dir, issue.id, readdirSync(path.join(dir, issue.id))[0]), 'utf8')).toBe(first);
  });
  it('berkas rusak atau dipalsukan (skema/issue tidak cocok) diabaikan, bukan dianggap approval', () => {
    const { dir, issue } = mk();
    const r = recordDecision({ token: TOKEN, expectedToken: TOKEN, issue, decision: 'rejected', note: 'x', contentHash: hash, dir });
    const d = path.join(dir, issue.id);
    writeFileSync(path.join(d, '9999_palsu.json'), JSON.stringify({ ...r, decision: 'approved', decided_by: 'agent' }));
    writeFileSync(path.join(d, '9999_rusak.json'), '{ bukan json');
    writeFileSync(path.join(d, '9999_lain.json'), JSON.stringify({ ...r, issue_id: randomUUID() }));
    expect(readDecisions(issue.id, dir)).toEqual([r]);
  });
});

describe('agent tidak punya jalur menulis approval', () => {
  it('tidak ada tool plugin untuk approve/reject/token, dan plugin tidak mengimpor owner-approval', () => {
    expect(Object.keys(TOOL_DEFS).filter((n) => /approv|reject|publish|owner_?decid|token/i.test(n))).toEqual([]);
    expect(Object.keys(makeAgentTools({})).filter((n) => /approv|reject|publish|token/i.test(n))).toEqual([]);
    const src = readdirSync(path.join(repoRoot, 'plugins', 'aao-approval-gate', 'src')).map((f) => readFileSync(path.join(repoRoot, 'plugins', 'aao-approval-gate', 'src', f), 'utf8')).join('\n');
    expect(src).not.toMatch(/owner-approval|AAO_OWNER_TOKEN/);
  });
});
