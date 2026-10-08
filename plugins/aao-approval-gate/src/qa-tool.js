// Tool qa_submit_result (F1.9b). Plugin MENGHITUNG ULANG hasil deterministik dari dokumen issue dan laporan renderer;
// agent QA tidak bisa menyodorkan laporan sendiri. Penilaian LLM hanya dapat menambah kegagalan.
//
// Dokumen issue yang dibaca (key): carousel, verification-result, carousel-design, research-output (opsional).
// Laporan visual dibaca dari workspace/issues/<issueId>/render/visual-qa.json (ditulis renderer).

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultRepoRoot } from './render-tool.js';
import { runQa } from '../../../scripts/qa-deterministic.mjs';
import { decide, combineVerdict, EMPTY_ROUNDS } from './qa-routing.js';

export class QaInputError extends Error {}

const STATE_NS = 'aao-qa';

async function readDoc(ctx, issueId, key, companyId, required = true) {
  const d = await ctx.issues.documents.get(issueId, key, companyId);
  if (!d?.body) {
    if (required) throw new QaInputError(`dokumen "${key}" belum terlampir di issue`);
    return undefined;
  }
  try { return JSON.parse(d.body); } catch { throw new QaInputError(`dokumen "${key}" bukan JSON valid`); }
}

export async function computeDeterministic(ctx, { issueId, companyId, repoRoot = defaultRepoRoot() }) {
  const [carousel, verification, design, research] = await Promise.all([
    readDoc(ctx, issueId, 'carousel', companyId),
    readDoc(ctx, issueId, 'verification-result', companyId),
    readDoc(ctx, issueId, 'carousel-design', companyId),
    readDoc(ctx, issueId, 'research-output', companyId, false),
  ]);
  let visualQa;
  const vf = path.join(repoRoot, 'workspace', 'issues', issueId, 'render', 'visual-qa.json');
  try { visualQa = JSON.parse((await readFile(vf, 'utf8')).replace(/^﻿/, '')); } catch { throw new QaInputError('laporan visual belum ada; jalankan render_carousel dulu'); }
  return runQa({ carousel, verification, design, visualQa, research });
}

export async function submitQaResult(ctx, { issueId, companyId, llm, repoRoot, maxRounds }) {
  const det = await computeDeterministic(ctx, { issueId, companyId, repoRoot });
  const scope = { scopeKind: 'issue', scopeId: issueId, namespace: STATE_NS, stateKey: 'rounds' };
  const stored = (await ctx.state.get(scope)) ?? EMPTY_ROUNDS;
  const verdict = combineVerdict(det, llm);
  const d = decide(stored, verdict, maxRounds);
  if (d.rounds.text !== stored.text || d.rounds.design !== stored.design) await ctx.state.set(scope, d.rounds);
  return { ...d, deterministic: { passed: det.passed, routeTo: det.routeTo, summary: det.summary, slides: det.slides, global: det.global }, verdict };
}
