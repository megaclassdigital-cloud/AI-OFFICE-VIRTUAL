#!/usr/bin/env node
// e2e-fixture.mjs — pipeline EdukasiAI end-to-end TANPA LLM (E1.1).
//
// Keluaran tiap "agent" diambil dari fixture; semua efek berjalan lewat tool plugin sungguhan di server Paperclip
// (attach_file, render_carousel, qa_submit_result, handoff_to_owner, post_comment) pada issue nyata.
// Agent yang dipakai sebagai assignee DI-PAUSE selama uji supaya penugasan tidak memicu run berbayar, lalu dipulihkan.
//
// Pemakaian: node scripts/e2e-fixture.mjs [--api http://127.0.0.1:3177/api] [--log <file.json>]

import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { normalizeResearch } from './normalize-research.mjs';
import { checkTopicSelection } from './check-topic-selection.mjs';
import { checkCarousel } from './check-carousel.mjs';
import { checkDesign } from './check-design.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const a = process.argv.slice(2);
const arg = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const API = arg('--api', 'http://127.0.0.1:3177/api');
const LOG = arg('--log', null);
const readJson = (rel) => JSON.parse(readFileSync(path.join(root, rel), 'utf8').replace(/^﻿/, ''));
const steps = [];
const log = (step, ok, detail) => { steps.push({ step, ok, ...detail }); console.log(`${ok ? 'OK  ' : 'GAGAL'} ${step}${detail?.note ? ` — ${detail.note}` : ''}`); if (!ok) throw new Error(`langkah gagal: ${step}`); };

const j = async (p, o) => { const r = await fetch(API + p, o); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const jb = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(body)) });

const company = (await j('/companies')).find((c) => /edukasi/i.test(c.name));
if (!company) throw new Error('company EdukasiAI tidak ditemukan; jalankan install-division');
const agents = await j(`/companies/${company.id}/agents`);
const researcher = agents.find((x) => x.role === 'researcher');
const project = (await j(`/companies/${company.id}/projects`))[0];
const hr = (await j(`/companies/${company.id}/heartbeat-runs?limit=1`))[0];
const runsBefore = (await j(`/companies/${company.id}/heartbeat-runs?limit=500`)).length;
const run = { companyId: company.id, agentId: researcher.id, runId: hr.id, projectId: project.id };

async function tool(name, parameters) {
  const r = await fetch(`${API}/plugins/tools/execute`, jb('POST', { tool: `aao-approval-gate:${name}`, parameters, runContext: run }));
  const x = await r.json();
  return x.result?.data ?? x;
}

const wasStatus = researcher.status;
let issue;
try {
  // Pause assignee supaya penugasan tidak membangunkan agent (tanpa run berbayar).
  if (wasStatus !== 'paused') await j(`/agents/${researcher.id}/pause`, jb('POST', {}));
  issue = await j(`/companies/${company.id}/issues`, jb('POST', { title: 'E1.1 E2E fixture: carousel berita AI', description: 'Pipeline uji tanpa LLM; keluaran dari fixture.', status: 'todo', projectId: project.id }));
  const patched = await j(`/issues/${issue.id}`, jb('PATCH', { assigneeAgentId: researcher.id, status: 'in_progress' }));
  log('issue dibuat dan ditugaskan (agent dipause)', patched.status === 'in_progress', { issue: issue.identifier, issueId: issue.id, note: `${issue.identifier} ${patched.status}` });
  const id = issue.id;

  // 1. Researcher: keluaran mentah nyata F0.2 -> normalisasi kode
  const raw = readJson('docs/spike/evidence/F0.2-research-output.json');
  let r1 = await tool('attach_file', { issueId: id, key: 'research-raw', body: JSON.stringify(raw) });
  const research = normalizeResearch(raw, { generatedAt: '2026-10-04T16:27:00Z' });
  r1 = await tool('attach_file', { issueId: id, key: 'research-output', body: JSON.stringify(research) });
  log('researcher: research-raw + research-output', r1.ok === true, { candidates: research.candidates.length });

  // 2. Verifier: fixture golden (sintetis; pemeriksaan URL nyata dicakup F1.3)
  const verification = readJson('fixtures/golden/valid/02-verification-result.json');
  const r2 = await tool('attach_file', { issueId: id, key: 'verification-result', body: JSON.stringify(verification) });
  log('verifier: verification-result', r2.ok === true, { verified: verification.results.filter((x) => x.status === 'verified').length });

  // 3. Pemilihan topik
  const topic = {
    selectedAt: '2026-10-04T16:50:00Z',
    ranking: [
      { candidateId: 'c04', scores: { relevance: 4, novelty: 4, impact: 5 }, note: 'Aturan kerja nyata' },
      { candidateId: 'c01', scores: { relevance: 3, novelty: 4, impact: 3 } },
      { candidateId: 'c02', scores: { relevance: 3, novelty: 3, impact: 3 } },
    ],
    selected: { candidateId: 'c04', reason: 'Skor tertinggi (13) dan langsung menyentuh dunia kerja pembaca Indonesia.' },
  };
  const t = checkTopicSelection(topic, verification);
  const r3 = await tool('attach_file', { issueId: id, key: 'topic-selection', body: JSON.stringify(topic) });
  log('pemilihan topik: lolos check-topic-selection', t.ok && r3.ok === true, { totals: t.totals });

  // 4. Copywriter
  const carousel = readJson('fixtures/golden/valid/03-carousel.json');
  const cc = checkCarousel(carousel, verification, { research });
  const r4 = await tool('attach_file', { issueId: id, key: 'carousel', body: JSON.stringify(carousel) });
  log('copywriter: carousel lolos check-carousel', cc.ok && r4.ok === true, { slides: carousel.slides.length });

  // 5. Designer
  const design = readJson('fixtures/golden/valid/04-carousel-design.json');
  const cd = checkDesign(design, carousel);
  const r5 = await tool('attach_file', { issueId: id, key: 'carousel-design', body: JSON.stringify(design) });
  log('designer: carousel-design lolos check-design', cd.ok && r5.ok === true, {});

  // 6. Render nyata lewat plugin
  mkdirSync(path.join(root, 'workspace', 'e2e'), { recursive: true });
  copyFileSync(path.join(root, 'fixtures', 'golden', 'valid', '04-carousel-design.json'), path.join(root, 'workspace', 'e2e', `${id}.json`));
  const r6 = await tool('render_carousel', { issueId: id, designPath: `e2e/${id}.json` });
  log('render_carousel (plugin)', r6.ok === true && r6.passed === true && r6.pngCount === 6, { pngCount: r6.pngCount, outDir: r6.outDir });

  // 7. QA
  const r7 = await tool('qa_submit_result', { issueId: id, llm: { textOk: true, designOk: true } });
  log('qa_submit_result = pass', r7.ok === true && r7.action === 'pass', { action: r7.action });

  // 8. Handoff
  const r8 = await tool('handoff_to_owner', { issueId: id });
  log('handoff_to_owner -> in_review (awaiting_approval)', r8.ok === true && r8.status === 'in_review', { contentHash: r8.contentHash });

  const final = await j(`/issues/${id}`);
  const docs = await j(`/issues/${id}/documents`);
  const keys = (Array.isArray(docs) ? docs : docs.documents ?? []).map((d) => d.key).sort();
  log('status akhir issue = in_review dan dokumen lengkap', final.status === 'in_review' && ['carousel', 'carousel-design', 'handoff', 'research-output', 'topic-selection', 'verification-result'].every((k) => keys.includes(k)), { status: final.status, documents: keys });

  // Agent tidak bisa menyetujui
  const ap = await tool('set_issue_status', { issueId: id, status: 'done' });
  log('agent tidak bisa menutup/menyetujui issue', ap.ok === false, { note: ap.error });
} finally {
  if (issue?.id) await j(`/issues/${issue.id}`, jb('PATCH', { assigneeAgentId: null })).catch(() => {});
  if (wasStatus !== 'paused') await j(`/agents/${researcher.id}/resume`, jb('POST', {})).catch(() => {});
}

const runsAfter = (await j(`/companies/${company.id}/heartbeat-runs?limit=500`)).length;
const agentAfter = await j(`/agents/${researcher.id}`);
const summary = { issue: issue.identifier, issueId: issue.id, newAgentRuns: runsAfter - runsBefore, agentStatusRestored: agentAfter.status, steps };
console.log(`\nRingkasan: issue ${issue.identifier}, run agent baru = ${summary.newAgentRuns}, status agent = ${agentAfter.status}`);
if (LOG) writeFileSync(LOG, JSON.stringify(summary, null, 2), 'utf8');
process.exit(summary.newAgentRuns === 0 ? 0 : 3);
