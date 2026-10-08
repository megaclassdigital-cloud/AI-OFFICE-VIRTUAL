#!/usr/bin/env node
// kpi-report.mjs — laporan KPI mingguan (F2.5) -> reports/kpi/kpi-YYYY-Www.md. Hanya MEMBACA (GET + berkas lokal).
//
// KPI PRD bagian 1, dihitung dari data nyata; yang belum punya data ditulis "belum ada data", bukan 0% palsu:
//   1 konsistensi (draf/minggu, 2 minggu berturut-turut)   2 akurasi sumber    3 lolos QA pertama kali
//   4 biaya (+ jumlah run dan durasi: billed_cents selalu 0)  5 publish tanpa approval   6 waktu manusia   7 kualitas visual
// Ledger uji AC0.5 (250 sen) dikecualikan dari biaya.
//
// Pemakaian: node scripts/kpi-report.mjs [--week 2026-W41] [--out reports/kpi] [--api http://127.0.0.1:3177/api]

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TEST_LEDGER_CENTS = 250;
const WIB = 7 * 3600_000;
const DAY = 86400_000;

/** Senin 00:00 WIB (sebagai epoch ms UTC) untuk minggu ISO. */
export function isoWeekStart(label) {
  const m = /^(\d{4})-W(\d{2})$/.exec(label);
  if (!m) throw new Error('format minggu: YYYY-Www, mis. 2026-W41');
  const jan4 = Date.UTC(+m[1], 0, 4);
  const dow = (new Date(jan4).getUTCDay() + 6) % 7; // Senin = 0
  return jan4 - dow * DAY + (+m[2] - 1) * 7 * DAY - WIB;
}
export function isoWeekLabel(ms) {
  const d = new Date(ms + WIB);
  const day = (d.getUTCDay() + 6) % 7;
  const thu = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3));
  const y = thu.getUTCFullYear();
  const wk = 1 + Math.round((thu - Date.UTC(y, 0, 4) + ((new Date(Date.UTC(y, 0, 4)).getUTCDay() + 6) % 7) * DAY - 3 * DAY) / (7 * DAY));
  return `${y}-W${String(wk).padStart(2, '0')}`;
}
const inRange = (iso, a, b) => { const t = Date.parse(iso); return Number.isFinite(t) && t >= a && t < b; };
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((p, q) => p - q); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const pct = (n, d) => (d === 0 ? null : Math.round((n / d) * 1000) / 10);

/**
 * @param {{start:number, issues:object[], runs:object[], approvals:object[], publishAudit:object[], spendCents:number}} inp
 *  issues[]: { id, identifier, docs:[{key,createdAt}], comments:[{createdAt,body}], carousel?, verification?, visualQa? }
 */
export function computeWeek({ start, issues, runs = [], approvals = [], publishAudit = [], spendCents = 0 }) {
  const end = start + 7 * DAY;
  const drafts = issues.filter((i) => i.docs.some((d) => d.key === 'handoff' && inRange(d.createdAt, start, end)));

  // 2 akurasi sumber: tiap sumber di carousel harus berstatus verified di verification-result
  let srcTotal = 0; let srcOk = 0;
  for (const i of drafts) {
    if (!i.carousel || !i.verification) continue;
    const ok = new Set(i.verification.results.filter((r) => r.status === 'verified').map((r) => r.candidateId));
    for (const s of i.carousel.sources ?? []) { srcTotal += 1; if (ok.has(s.candidateId)) srcOk += 1; }
  }

  // 3 lolos QA pertama kali: komentar "QA: ..." pertama per issue
  let qaIssues = 0; let qaFirstPass = 0;
  for (const i of issues) {
    const qa = i.comments.filter((c) => /^QA:\s/.test(c.body) && inRange(c.createdAt, start, end)).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    if (!qa.length) continue;
    qaIssues += 1;
    if (/^QA:\s*pass\b/.test(qa[0].body)) qaFirstPass += 1;
  }

  // 4 run dan durasi
  const wkRuns = runs.filter((r) => inRange(r.startedAt ?? r.createdAt, start, end));
  const durMs = wkRuns.reduce((s, r) => s + Math.max(0, (Date.parse(r.finishedAt) || 0) - (Date.parse(r.startedAt) || 0)), 0);
  const tok = wkRuns.reduce((s, r) => s + (r.usageJson?.inputTokens ?? 0) + (r.usageJson?.outputTokens ?? 0), 0);

  // 5 publish tanpa approval: setiap publish_prepared harus punya record approved dengan issue+hash sama
  const prepared = publishAudit.filter((e) => e.event === 'publish_prepared' && inRange(e.at, start, end));
  const approved = approvals.filter((a) => a.decision === 'approved');
  const unapproved = prepared.filter((e) => !approved.some((a) => a.issue_id === e.issue_id && a.content_hash?.combined === e.content_hash));
  const refused = publishAudit.filter((e) => String(e.event).startsWith('publish_refused') && inRange(e.at, start, end)).length;

  // 6 waktu manusia: handoff -> keputusan owner (menit)
  const mins = [];
  for (const i of drafts) {
    const h = Date.parse(i.docs.find((d) => d.key === 'handoff').createdAt);
    const dec = approvals.filter((a) => a.issue_id === i.id && Date.parse(a.decided_at) >= h).sort((a, b) => Date.parse(a.decided_at) - Date.parse(b.decided_at))[0];
    if (dec) mins.push((Date.parse(dec.decided_at) - h) / 60000);
  }

  // 7 kualitas visual
  let slides = 0; let slidesOk = 0;
  for (const i of drafts) for (const s of i.visualQa?.slides ?? []) { slides += 1; if (s.passed) slidesOk += 1; }

  const fixtureDrafts = drafts.filter((i) => i.fixture).length;
  return {
    drafts: drafts.length, fixtureDrafts, draftIds: drafts.map((i) => i.identifier + (i.fixture ? ' (fixture)' : '')),
    sourceAccuracy: { total: srcTotal, ok: srcOk, pct: pct(srcOk, srcTotal) },
    qaFirstPass: { issues: qaIssues, pass: qaFirstPass, pct: pct(qaFirstPass, qaIssues) },
    cost: { spendCents: Math.max(0, spendCents - TEST_LEDGER_CENTS), rawSpendCents: spendCents, runs: wkRuns.length, failedRuns: wkRuns.filter((r) => r.status !== 'succeeded').length, durationMin: Math.round(durMs / 600) / 100, tokens: tok },
    publishWithoutApproval: { count: unapproved.length, prepared: prepared.length, refused },
    humanTime: { decided: mins.length, medianMin: median(mins) === null ? null : Math.round(median(mins) * 10) / 10, within5: mins.filter((m) => m <= 5).length },
    visual: { slides, ok: slidesOk, pct: pct(slidesOk, slides) },
  };
}

const f = (v, unit = '') => (v === null || v === undefined ? 'belum ada data' : `${v}${unit}`);
const verdict = (ok, tag = '') => (ok === null ? 'BELUM ADA DATA' : `${ok ? 'TERCAPAI' : 'BELUM'}${tag}`);

export function renderMarkdown({ weekLabel, prevLabel, cur, prev, generatedAt }) {
  const consecutive = cur.drafts >= 5 && prev.drafts >= 5;
  const fx = cur.drafts > 0 && cur.fixtureDrafts === cur.drafts ? ' — DATA FIXTURE, bukan kinerja agent' : '';
  const costNote = cur.cost.runs > 0 && cur.cost.spendCents === 0 ? 'TIDAK TERUKUR (langganan: billed_cents selalu 0; lihat run/durasi/token)' : verdict(cur.cost.spendCents <= 500);
  const rows = [
    ['Konsistensi produksi', `${cur.drafts} draf (${prevLabel}: ${prev.drafts}); 5/minggu selama 2 minggu berturut-turut`, verdict(cur.drafts === 0 && prev.drafts === 0 ? null : consecutive, fx)],
    ['Akurasi sumber', `${f(cur.sourceAccuracy.pct, '%')} (${cur.sourceAccuracy.ok}/${cur.sourceAccuracy.total} sumber verified); target 100%`, verdict(cur.sourceAccuracy.pct === null ? null : cur.sourceAccuracy.pct === 100, fx)],
    ['Lolos QA pertama kali', `${f(cur.qaFirstPass.pct, '%')} (${cur.qaFirstPass.pass}/${cur.qaFirstPass.issues} issue); target ≥ 60%`, verdict(cur.qaFirstPass.pct === null ? null : cur.qaFirstPass.pct >= 60, fx)],
    ['Biaya', `USD ${(cur.cost.spendCents / 100).toFixed(2)} (setelah mengecualikan ledger uji ${TEST_LEDGER_CENTS} sen; mentah ${cur.cost.rawSpendCents} sen, KUMULATIF sejak awal, bukan per minggu); ${cur.cost.runs} run, ${cur.cost.failedRuns} gagal, ${cur.cost.durationMin} menit, ${cur.cost.tokens} token`, costNote],
    ['Publish tanpa approval', `${cur.publishWithoutApproval.count} kejadian dari ${cur.publishWithoutApproval.prepared} paket; ${cur.publishWithoutApproval.refused} percobaan ditolak`, verdict(cur.publishWithoutApproval.count === 0)],
    ['Waktu manusia per draf', `median ${f(cur.humanTime.medianMin, ' menit')} (${cur.humanTime.within5}/${cur.humanTime.decided} ≤ 5 menit); target ≤ 5 menit`, verdict(cur.humanTime.medianMin === null ? null : cur.humanTime.medianMin <= 5, fx)],
    ['Kualitas visual', `${f(cur.visual.pct, '%')} (${cur.visual.ok}/${cur.visual.slides} slide lolos cek otomatis); target 100%`, verdict(cur.visual.pct === null ? null : cur.visual.pct === 100, fx)],
  ];
  return [
    `# Laporan KPI ${weekLabel}`, '',
    `Dibuat otomatis oleh \`scripts/kpi-report.mjs\` pada ${generatedAt}. Hanya membaca data; tidak mengubah apa pun.`, '',
    '| KPI | Hasil | Status |', '| --- | --- | --- |',
    ...rows.map((r) => `| ${r[0]} | ${r[1]} | ${r[2]} |`), '',
    '## Catatan', '',
    `- Draf minggu ini: ${cur.draftIds.join(', ') || '—'}.`,
    '- "Draf" = issue yang mendapat dokumen `handoff` (lolos QA) pada minggu itu; dokumen `handoff` hanya bisa ditulis tool plugin. Issue berjudul fixture/E2E ditandai "(fixture)".',
    '- Biaya dari Paperclip selalu 0 untuk langganan codex_local; karena itu jumlah run, durasi, dan token dilaporkan.',
    '- "BELUM ADA DATA" berarti belum ada kejadian yang bisa diukur, bukan lulus.', '',
  ].join('\n');
}

function client(api) {
  const g = async (p) => { const r = await fetch(api + p); if (!r.ok) throw new Error(`Paperclip HTTP ${r.status} ${p}`); return r.json(); };
  return { g };
}

export async function collect(api, { start }) {
  const { g } = client(api);
  const co = (await g('/companies')).find((c) => /edukasi/i.test(c.name) && !/mega\s*class/i.test(c.name));
  if (!co) throw new Error('company EdukasiAI tidak ditemukan');
  const issueList = await g(`/companies/${co.id}/issues`);
  const issues = [];
  for (const i of issueList) {
    const docsRaw = await g(`/issues/${i.id}/documents`).catch(() => []);
    const docs = (Array.isArray(docsRaw) ? docsRaw : docsRaw.documents ?? []);
    const comments = await g(`/issues/${i.id}/comments`).catch(() => []);
    const body = (k) => { const d = docs.find((x) => x.key === k); try { return d?.body ? JSON.parse(d.body) : undefined; } catch { return undefined; } };
    const vqFile = path.join(repoRoot, 'workspace', 'issues', i.id, 'render', 'visual-qa.json');
    issues.push({
      id: i.id, identifier: i.identifier, fixture: /fixture|e2e|\buji\b|\btest\b/i.test(i.title ?? ''), docs: docs.map((d) => ({ key: d.key, createdAt: d.createdAt })),
      comments: (Array.isArray(comments) ? comments : comments.comments ?? []).map((c) => ({ createdAt: c.createdAt, body: String(c.body ?? '') })),
      carousel: body('carousel'), verification: body('verification-result'),
      visualQa: existsSync(vqFile) ? JSON.parse(readFileSync(vqFile, 'utf8').replace(/^﻿/, '')) : undefined,
    });
  }
  const runs = await g(`/companies/${co.id}/heartbeat-runs?limit=500`);
  const spend = await g(`/companies/${co.id}/costs/summary`);
  const approvals = [];
  const ad = path.join(repoRoot, 'output', 'approvals');
  if (existsSync(ad)) {
    const { readDecisions } = await import('./owner-approval.mjs');
    for (const i of issues) approvals.push(...readDecisions(i.id));
  }
  const af = path.join(repoRoot, 'output', 'audit.log');
  const publishAudit = existsSync(af) ? readFileSync(af, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }) : [];
  return { start, issues, runs, approvals, publishAudit, spendCents: spend.spendCents ?? 0 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const arg = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
  try {
    const weekLabel = arg('--week', isoWeekLabel(Date.now()));
    const start = isoWeekStart(weekLabel);
    const prevLabel = isoWeekLabel(start - DAY);
    const data = await collect(arg('--api', 'http://127.0.0.1:3177/api'), { start });
    const md = renderMarkdown({ weekLabel, prevLabel, cur: computeWeek(data), prev: computeWeek({ ...data, start: isoWeekStart(prevLabel) }), generatedAt: new Date().toISOString() });
    const outDir = path.resolve(arg('--out', path.join(repoRoot, 'reports', 'kpi')));
    mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `kpi-${weekLabel}.md`);
    writeFileSync(file, md, 'utf8');
    console.log(file);
  } catch (e) { console.error(`GAGAL: ${e.message}`); process.exitCode = 2; }
}
