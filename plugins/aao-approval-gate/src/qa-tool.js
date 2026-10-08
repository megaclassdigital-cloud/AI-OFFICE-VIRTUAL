// Tool qa_submit_result (F1.9b) dan dasar handoff (F1.10). Plugin MENGHITUNG ULANG hasil deterministik dari dokumen
// issue dan laporan renderer; agent QA tidak bisa menyodorkan laporan sendiri. Penilaian LLM hanya dapat menambah kegagalan.
//
// Dokumen issue yang dibaca (key): carousel, verification-result, carousel-design, research-output (opsional).
// Laporan visual dan hash PNG: segel yang disimpan render_carousel di state plugin (provenance.js); PNG di disk dihitung ulang.

import path from 'node:path';
import { defaultRepoRoot } from './render-tool.js';
import { runQa } from '../../../scripts/qa-deterministic.mjs';
import { decide, combineVerdict, EMPTY_ROUNDS } from './qa-routing.js';
import { packageContentHash } from './content-hash.js';
import { renderScope, verifyScope, checkVerificationProvenance, checkRenderSeal } from './provenance.js';
import { validate } from '../../../schemas/validate.mjs';

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

/** @returns {{report:object, contentHash:object, renderDir:string}} */
export async function computeDeterministic(ctx, { issueId, companyId, repoRoot = defaultRepoRoot() }) {
  const [carousel, verification, design, research] = await Promise.all([
    readDoc(ctx, issueId, 'carousel', companyId),
    readDoc(ctx, issueId, 'verification-result', companyId),
    readDoc(ctx, issueId, 'carousel-design', companyId),
    readDoc(ctx, issueId, 'research-output', companyId),
  ]);
  const seal = await ctx.state.get(renderScope(issueId));
  if (!seal?.visualQa || !seal?.hashes) throw new QaInputError('belum ada hasil render_carousel untuk issue ini; jalankan render_carousel dulu');
  const renderDir = path.join(repoRoot, 'workspace', 'issues', issueId, 'render');
  const sealCheck = await checkRenderSeal(seal, design, renderDir);
  const verifyLog = (await ctx.state.get(verifyScope(issueId))) ?? {};
  const provenance = validate('verification-result', verification).ok ? checkVerificationProvenance(verification, verifyLog) : [];
  const report = runQa({ carousel, verification, design, visualQa: seal.visualQa, research, requireResearch: true, extraErrors: { text: provenance, visual: sealCheck.errors } });
  return {
    report,
    contentHash: packageContentHash({ carousel, design }, seal.hashes),
    renderDir,
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
