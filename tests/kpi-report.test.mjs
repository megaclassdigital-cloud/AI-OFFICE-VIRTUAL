// Test F2.5: perhitungan KPI dari data sintetis; ledger uji dikecualikan; "belum ada data" tidak berpura-pura 0%.
import { describe, it, expect } from 'vitest';
import { computeWeek, renderMarkdown, isoWeekStart, isoWeekLabel, TEST_LEDGER_CENTS } from '../scripts/kpi-report.mjs';

const DAY = 86400_000;
const START = isoWeekStart('2026-W41'); // Senin 5 Okt 2026 00:00 WIB
const at = (dayOffset, hour = 12) => new Date(START + dayOffset * DAY + hour * 3600_000).toISOString();

const verification = { results: [{ candidateId: 'c01', status: 'verified' }, { candidateId: 'c02', status: 'rejected' }] };
const draft = (n, over = {}) => ({
  id: `id${n}`, identifier: `EDU-${n}`, docs: [{ key: 'handoff', createdAt: at(1, 9) }],
  comments: [{ createdAt: at(1, 8), body: 'QA: pass — semua cek lolos' }],
  carousel: { sources: [{ candidateId: 'c01' }] }, verification,
  visualQa: { slides: [{ passed: true }, { passed: true }] }, ...over,
});
const hash = (n) => ({ combined: String(n).repeat(64).slice(0, 64) });

describe('minggu ISO', () => {
  it('2026-W41 dimulai Senin 5 Oktober 2026 00:00 WIB dan label balik benar', () => {
    expect(new Date(START).toISOString()).toBe('2026-10-04T17:00:00.000Z');
    expect(isoWeekLabel(START)).toBe('2026-W41');
    expect(isoWeekLabel(START - 1)).toBe('2026-W40');
    expect(isoWeekLabel(START + 6 * DAY + 20 * 3600_000)).toBe('2026-W41');
  });
});

describe('computeWeek', () => {
  it('tanpa data: semua KPI null/0, bukan persen palsu', () => {
    const r = computeWeek({ start: START, issues: [] });
    expect(r.drafts).toBe(0);
    expect([r.sourceAccuracy.pct, r.qaFirstPass.pct, r.humanTime.medianMin, r.visual.pct]).toEqual([null, null, null, null]);
  });
  it('draf dihitung dari dokumen handoff pada minggu itu saja', () => {
    const old = draft(9, { docs: [{ key: 'handoff', createdAt: at(-3) }] });
    const r = computeWeek({ start: START, issues: [draft(1), draft(2), old] });
    expect(r.drafts).toBe(2);
    expect(r.draftIds).toEqual(['EDU-1', 'EDU-2']);
  });
  it('akurasi sumber: sumber yang tidak verified menurunkan persen', () => {
    const bad = draft(3, { carousel: { sources: [{ candidateId: 'c01' }, { candidateId: 'c02' }] } });
    expect(computeWeek({ start: START, issues: [draft(1), bad] }).sourceAccuracy).toEqual({ total: 3, ok: 2, pct: 66.7 });
  });
  it('lolos QA pertama kali memakai komentar QA pertama per issue', () => {
    const revised = draft(4, { comments: [{ createdAt: at(1, 7), body: 'QA: return_to_copywriter — x' }, { createdAt: at(1, 9), body: 'QA: pass — ok' }] });
    const r = computeWeek({ start: START, issues: [draft(1), revised] });
    expect(r.qaFirstPass).toEqual({ issues: 2, pass: 1, pct: 50 });
  });
  it('biaya mengecualikan ledger uji 250 sen dan tidak negatif; run dan durasi dihitung', () => {
    const runs = [
      { status: 'succeeded', startedAt: at(1, 8), finishedAt: at(1, 9), usageJson: { inputTokens: 100, outputTokens: 50 } },
      { status: 'failed', startedAt: at(2, 8), finishedAt: at(2, 8) },
      { status: 'succeeded', startedAt: at(-10), finishedAt: at(-10) },
    ];
    const r = computeWeek({ start: START, issues: [], runs, spendCents: 250 });
    expect(TEST_LEDGER_CENTS).toBe(250);
    expect(r.cost).toMatchObject({ spendCents: 0, rawSpendCents: 250, runs: 2, failedRuns: 1, durationMin: 60, tokens: 150 });
    expect(computeWeek({ start: START, issues: [], spendCents: 100 }).cost.spendCents).toBe(0);
    expect(computeWeek({ start: START, issues: [], spendCents: 400 }).cost.spendCents).toBe(150);
  });
  it('publish tanpa approval: paket tanpa record approved bertaut hash terdeteksi', () => {
    const approvals = [{ issue_id: 'id1', decision: 'approved', content_hash: hash(1), decided_at: at(1, 9.05) }];
    const audit = [
      { event: 'publish_prepared', issue_id: 'id1', content_hash: hash(1).combined, at: at(2) },
      { event: 'publish_prepared', issue_id: 'id2', content_hash: hash(2).combined, at: at(2) },
      { event: 'publish_refused_no_approval', issue_id: 'id3', at: at(3) },
    ];
    expect(computeWeek({ start: START, issues: [], approvals, publishAudit: audit }).publishWithoutApproval).toEqual({ count: 1, prepared: 2, refused: 1 });
  });
  it('waktu manusia: median menit dari handoff ke keputusan owner', () => {
    const approvals = [
      { issue_id: 'id1', decision: 'approved', content_hash: hash(1), decided_at: new Date(Date.parse(at(1, 9)) + 3 * 60000).toISOString() },
      { issue_id: 'id2', decision: 'rejected', content_hash: hash(1), decided_at: new Date(Date.parse(at(1, 9)) + 9 * 60000).toISOString() },
    ];
    expect(computeWeek({ start: START, issues: [draft(1), draft(2)], approvals }).humanTime).toEqual({ decided: 2, medianMin: 6, within5: 1 });
  });
  it('kualitas visual: slide gagal menurunkan persen', () => {
    const v = draft(5, { visualQa: { slides: [{ passed: true }, { passed: false }] } });
    expect(computeWeek({ start: START, issues: [draft(1), v] }).visual).toEqual({ slides: 4, ok: 3, pct: 75 });
  });
});

describe('label jujur (FIX-G2-07)', () => {
  const gen = (cur, prev) => renderMarkdown({ weekLabel: '2026-W41', prevLabel: '2026-W40', cur, prev, generatedAt: 'x' });
  it('semua draf fixture: status KPI berbasis draf diberi label DATA FIXTURE dan draf ditandai', () => {
    const w = computeWeek({ start: START, issues: [draft(1, { fixture: true }), draft(2, { fixture: true })] });
    expect(w.fixtureDrafts).toBe(2);
    const md = gen(w, w);
    expect(md).toMatch(/Akurasi sumber \|[^\n]*DATA FIXTURE/);
    expect(md).toMatch(/Kualitas visual \|[^\n]*DATA FIXTURE/);
    expect(md).toContain('EDU-1 (fixture)');
  });
  it('draf nyata tidak diberi label fixture', () => {
    const w = computeWeek({ start: START, issues: [draft(1)] });
    expect(gen(w, w)).not.toContain('DATA FIXTURE');
  });
  it('biaya: ada run tetapi biaya 0 -> TIDAK TERUKUR (bukan TERCAPAI); biaya diberi label kumulatif', () => {
    const w = computeWeek({ start: START, issues: [], runs: [{ status: 'succeeded', startedAt: at(1, 8), finishedAt: at(1, 9) }], spendCents: 250 });
    const md = gen(w, w);
    expect(md).toMatch(/\| Biaya \|[^\n]*KUMULATIF[^\n]*\| TIDAK TERUKUR/);
  });
});

describe('renderMarkdown', () => {
  const none = computeWeek({ start: START, issues: [] });
  it('tanpa data tertulis BELUM ADA DATA, bukan TERCAPAI', () => {
    const md = renderMarkdown({ weekLabel: '2026-W41', prevLabel: '2026-W40', cur: none, prev: none, generatedAt: 'x' });
    expect(md).toContain('| Akurasi sumber | belum ada data');
    expect(md.match(/BELUM ADA DATA/g).length).toBeGreaterThanOrEqual(5);
    expect(md).not.toMatch(/Konsistensi produksi \|[^\n]*TERCAPAI/);
  });
  it('7 KPI PRD hadir dan 5 draf dua minggu berturut-turut = TERCAPAI', () => {
    const five = computeWeek({ start: START, issues: [1, 2, 3, 4, 5].map((n) => draft(n)) });
    const md = renderMarkdown({ weekLabel: '2026-W41', prevLabel: '2026-W40', cur: five, prev: five, generatedAt: 'x' });
    for (const k of ['Konsistensi produksi', 'Akurasi sumber', 'Lolos QA pertama kali', 'Biaya', 'Publish tanpa approval', 'Waktu manusia per draf', 'Kualitas visual']) expect(md).toContain(`| ${k} |`);
    expect(md).toMatch(/Konsistensi produksi \|[^\n]*TERCAPAI/);
  });
});
