// Tool qa_submit_result (F1.9b) dan dasar handoff (F1.10). Plugin MENGHITUNG ULANG hasil deterministik dari dokumen
// issue dan laporan renderer; agent QA tidak bisa menyodorkan laporan sendiri. Penilaian LLM hanya dapat menambah kegagalan.
//
// Dokumen issue yang dibaca (key): carousel, verification-result, carousel-design, research-output (opsional).
// Laporan visual: workspace/issues/<issueId>/render/{visual-qa.json,hashes.json} (ditulis renderer).

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultRepoRoot } from './render-tool.js';
import { runQa } from '../../../scripts/qa-deterministic.mjs';
import { decide, combineVerdict, EMPTY_ROUNDS } from './qa-routing.js';
import { packageContentHash } from './content-hash.js';

export class QaInputError extends Error {}

const STATE_NS = 'aao-qa';
export const roundsScope = (issueId) => ({ scopeKind: 'issue', scopeId: issueId, namespace: STATE_NS, stateKey: 'rounds' });
export const verdictScope = (issueId) => ({ scopeKind: 'issue', scopeId: issueId, namespace: STATE_NS, stateKey: 'verdict' });

async function readDoc(ctx, issueId, key, companyId, required = true) {
  const d = await ctx.issues.documents.get(issueId, key, companyId);
  if (!d?.body) {
    if (required) throw new QaInputError(`dokumen "${key}" belum terlampir di issue`);
    return undefined;
  }
  try { return JSON.parse(d.body); } catch { throw new QaInputError(`dokumen "${key}" bukan JSON valid`); }
}

async function readRenderJson(repoRoot, issueId, file) {
  const f = path.join(repoRoot, 'workspace', 'issues', issueId, 'render', file);
  try { return JSON.parse((await readFile(f, 'utf8')).replace(/^﻿/, '')); } catch { throw new QaInputError(`${file} belum ada; jalankan render_carousel dulu`); }
}

/** @returns {{report:object, contentHash:object, renderDir:string}} */
export async function computeDeterministic(ctx, { issueId, companyId, repoRoot = defaultRepoRoot() }) {
  const [carousel, verification, design, research] = await Promise.all([
    readDoc(ctx, issueId, 'carousel', companyId),
    readDoc(ctx, issueId, 'verification-result', companyId),
    readDoc(ctx, issueId, 'carousel-design', companyId),
    readDoc(ctx, issueId, 'research-output', companyId, false),
  ]);
  const visualQa = await readRenderJson(repoRoot, issueId, 'visual-qa.json');
  const hashes = await readRenderJson(repoRoot, issueId, 'hashes.json');
  const report = runQa({ carousel, verification, design, visualQa, research });
  return {
    report,
    contentHash: packageContentHash({ carousel, design }, hashes),
    renderDir: path.join(repoRoot, 'workspace', 'issues', issueId, 'render'),
    carousel,
  };
}

export async function submitQaResult(ctx, { issueId, companyId, llm, repoRoot, maxRounds }) {
  const { report: det, contentHash } = await computeDeterministic(ctx, { issueId, companyId, repoRoot });
  const stored = (await ctx.state.get(roundsScope(issueId))) ?? EMPTY_ROUNDS;
  const verdict = combineVerdict(det, llm);
  const d = decide(stored, verdict, maxRounds);
  if (d.rounds.text !== stored.text || d.rounds.design !== stored.design) await ctx.state.set(roundsScope(issueId), d.rounds);
  // Catat vonis lolos TERIKAT pada hash isi paket; perubahan apa pun sesudahnya membatalkan vonis (dipakai handoff F1.10).
  await ctx.state.set(verdictScope(issueId), d.action === 'pass' ? { action: 'pass', contentHash: contentHash.combined, at: new Date().toISOString() } : { action: d.action, contentHash: null });
  return { ...d, deterministic: { passed: det.passed, routeTo: det.routeTo, summary: det.summary, slides: det.slides, global: det.global }, verdict };
}
