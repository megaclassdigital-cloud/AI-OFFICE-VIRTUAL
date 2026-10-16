import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeTmp } from './helpers.mjs';
import { packageContentHash } from '../plugins/aao-approval-gate/src/content-hash.js';
import { latestDecisions, currentContentHash, approvedCandidates, nextToPost, buildStatus } from '../scripts/autopost/queue.mjs';

const SINCE = Date.UTC(2026, 9, 16, 6, 0);
const NOW = Date.UTC(2026, 9, 16, 12, 0);
const put = (p, o) => { mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(o)); };

/** Siapkan satu konten dengan paket + (opsional) catatan approval. */
function makeContent(out, { content, master = content, revision = 0, decision = 'approved', at = '2026-10-16T08:00:00Z', tamper = false }) {
  const key = revision ? `${content}/revision-${revision}` : content;
  const dir = path.join(out, 'runs', ...key.split('/'));
  const carousel = { caption: 'c ' + content, slides: [] }; const design = { slides: [] }; const hashes = { 'slide-01.png': 'a'.repeat(64), 'slide-02.png': 'b'.repeat(64) };
  put(path.join(dir, 'carousel.json'), carousel); put(path.join(dir, 'carousel-design.json'), design); put(path.join(dir, 'render', 'hashes.json'), hashes);
  if (revision) put(path.join(dir, 'run.json'), { runKey: key, contentId: content, revision, masterIdentifier: master });
  const hash = packageContentHash({ carousel, design }, hashes);
  if (tamper) put(path.join(dir, 'carousel.json'), { ...carousel, caption: 'DIUBAH' });
  const issueDir = path.join(out, 'approvals', 'issue-' + master);
  put(path.join(issueDir, at.replace(/[:.]/g, '-') + '_x.json'), { issue_identifier: master, decision, decided_at: at, content_hash: hash });
  return key;
}

describe('antrean autoposter dari approval owner', () => {
  it('hanya keputusan TERAKHIR per issue yang berlaku', () => {
    const out = makeTmp(); makeContent(out, { content: 'EDU-1', at: '2026-10-16T08:00:00Z' });
    put(path.join(out, 'approvals', 'issue-EDU-1', 'later.json'), { issue_identifier: 'EDU-1', decision: 'rejected', decided_at: '2026-10-16T09:00:00Z', content_hash: {} });
    expect(latestDecisions(path.join(out, 'approvals')).get('issue-EDU-1').decision).toBe('rejected');
    expect(approvedCandidates({ outputs: out, approvalsDir: path.join(out, 'approvals'), sinceMs: SINCE }).candidates).toEqual([]);
  });
  it('approval sebelum autopostSince diabaikan (konten lama tidak diposting tiba-tiba); tanpa autopostSince semuanya diabaikan', () => {
    const out = makeTmp(); makeContent(out, { content: 'EDU-1', at: '2026-10-15T02:00:00Z' }); makeContent(out, { content: 'EDU-2', at: '2026-10-16T08:00:00Z' });
    const r = approvedCandidates({ outputs: out, approvalsDir: path.join(out, 'approvals'), sinceMs: SINCE });
    expect(r.candidates.map((c) => c.content)).toEqual(['EDU-2']); expect(r.ignored.map((i) => i.content)).toEqual(['EDU-1']); expect(r.ignored[0].reason).toMatch(/konten lama/);
    expect(approvedCandidates({ outputs: out, approvalsDir: path.join(out, 'approvals'), sinceMs: null }).candidates).toEqual([]);
  });
  it('master revisi dipetakan ke kode konten dan folder revisi; hash cocok dengan yang disetujui, berubah => tidak cocok', () => {
    const out = makeTmp(); const key = makeContent(out, { content: 'EDU-97', master: 'EDU-105', revision: 1 });
    const ok = approvedCandidates({ outputs: out, approvalsDir: path.join(out, 'approvals'), sinceMs: SINCE }).candidates[0];
    expect(ok).toMatchObject({ content: 'EDU-97', runKey: key, identifier: 'EDU-105', hashMatches: true });
    const bad = makeTmp(); makeContent(bad, { content: 'EDU-3', tamper: true });
    expect(approvedCandidates({ outputs: bad, approvalsDir: path.join(bad, 'approvals'), sinceMs: SINCE }).candidates[0].hashMatches).toBe(false);
    expect(currentContentHash(out, key)).toBe(ok.currentHash);
  });
  it('nextToPost: tertua dulu, hanya platform live, menghormati jeda, ledger, dan hash', () => {
    const out = makeTmp(); makeContent(out, { content: 'EDU-1', at: '2026-10-16T07:00:00Z' }); makeContent(out, { content: 'EDU-2', at: '2026-10-16T08:00:00Z' });
    const { candidates } = approvedCandidates({ outputs: out, approvalsDir: path.join(out, 'approvals'), sinceMs: SINCE });
    const live = { platforms: { instagram: { live: true }, tiktok: { live: false } } };
    const r = nextToPost({ candidates, ledger: [], settings: live, nowMs: NOW });
    expect(r.pick).toMatchObject({ platform: 'instagram', candidate: { content: 'EDU-1' } });
    // setelah EDU-1 diposting 1 jam lalu: jeda 3 jam menahan EDU-2
    const posted = [{ content: 'EDU-1', platform: 'instagram', mode: 'live', status: 'diposting', at: new Date(NOW - 3600_000).toISOString() }];
    const r2 = nextToPost({ candidates, ledger: posted, settings: live, nowMs: NOW });
    expect(r2.pick).toBeNull(); expect(r2.blocked.some((b) => b.content === 'EDU-2' && /jeda 3 jam/.test(b.reasons.join(' ')))).toBe(true);
    // jeda lewat: EDU-1 sudah diposting (tidak diulang), EDU-2 giliran
    const later = [{ ...posted[0], at: new Date(NOW - 4 * 3600_000).toISOString() }];
    expect(nextToPost({ candidates, ledger: later, settings: live, nowMs: NOW }).pick.candidate.content).toBe('EDU-2');
    // semua platform mati live: tidak ada yang diposting
    expect(nextToPost({ candidates, ledger: [], settings: {}, nowMs: NOW }).pick).toBeNull();
    // hash tidak cocok ditolak
    const bad = makeTmp(); makeContent(bad, { content: 'EDU-9', tamper: true });
    const cb = approvedCandidates({ outputs: bad, approvalsDir: path.join(bad, 'approvals'), sinceMs: SINCE }).candidates;
    expect(nextToPost({ candidates: cb, ledger: [], settings: live, nowMs: NOW }).pick).toBeNull();
  });
  it('status memuat hitung mundur per platform dan jumlah konten lama yang diabaikan', () => {
    const posted = [{ content: 'EDU-1', platform: 'instagram', mode: 'live', status: 'diposting', at: new Date(NOW - 3600_000).toISOString() }];
    const st = buildStatus({ settings: { autopostSince: '2026-10-16T06:00:00Z', platforms: { instagram: { live: true } } }, ledger: posted, candidates: [{ content: 'EDU-2' }], ignored: [{}, {}], blocked: [], nowMs: NOW });
    expect(st.platforms.instagram).toMatchObject({ live: true, ready: false, remainingText: '2 jam', postedTotal: 1 });
    expect(st.platforms.tiktok.live).toBe(false); expect(st.approvedWaiting).toBe(1); expect(st.ignoredOld).toBe(2);
  });
});
