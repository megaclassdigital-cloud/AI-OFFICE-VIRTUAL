#!/usr/bin/env node
// finalize-production.mjs — deterministic hand-off of a finished production to the owner approval gate.
// All provenance lives on ONE issue (the production/master issue): documents, verify_candidate records, render seal, QA result, handoff.
// Steps (code, not LLM): attach docs -> verify_candidate per verified candidate -> render_carousel (seal) -> qa_submit_result -> handoff_to_owner.
// The QA *judgement* (textOk/designOk) always comes from the QA agent's own accepted result; this script never invents it.
// Usage: node scripts/finalize-production.mjs EDU-27 [--text-ok true --design-ok true]   (flags only override a missing QA judgement)
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'http://127.0.0.1:3177/api';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, ''));

/** Pure: QA judgement from the QA agent's accepted result. Returns { textOk, designOk } or null. */
export function llmFromQaResult(q, override = {}) {
  const r = q?.llmReview;
  if (r && typeof r.textOk === 'boolean' && typeof r.designOk === 'boolean') return { textOk: r.textOk, designOk: r.designOk };
  if (typeof override.textOk === 'boolean' && typeof override.designOk === 'boolean') return { textOk: override.textOk, designOk: override.designOk };
  return null;
}

/** Pure: which candidates need a verify_candidate record, with the published date taken from the research output. */
export function verificationTargets(verification, research) {
  const byId = new Map((research?.candidates ?? []).map((c) => [c.id, c]));
  return (verification?.results ?? []).filter((r) => r.status === 'verified').map((r) => ({ candidateId: r.candidateId, url: r.url, published_at: byId.get(r.candidateId)?.published_at ?? r.checks?.dateWithinWindow?.publishedAt ?? '' }));
}

async function main() {
  const a = process.argv.slice(2);
  const prod = a[0];
  if (!/^EDU-[0-9]+$/.test(prod ?? '')) { console.error('Pemakaian: node scripts/finalize-production.mjs EDU-27'); return 2; }
  const runKey = a.includes('--run') ? a[a.indexOf('--run') + 1] : prod; // folder run (EDU-49/revision-N untuk revisi); prod = identifier issue master Paperclip
  if (!/^EDU-[0-9]+(?:\/revision-[0-9]+)?$/.test(runKey)) { console.error('--run tidak valid'); return 2; }
  const flag = (n) => (a.includes(n) ? a[a.indexOf(n) + 1] === 'true' : undefined);
  const dir = path.join(ROOT, 'workspace', 'agent', 'runs', ...runKey.split('/'));
  const j = async (p, o) => { const r = await fetch(API + p, o); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
  const jb = (b) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(b), 'utf8') });
  const log = (m) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);

  const company = (await j('/companies')).find((c) => /edukasi/i.test(c.name));
  const agents = await j(`/companies/${company.id}/agents`);
  const issues = await j(`/companies/${company.id}/issues`);
  const master = issues.find((i) => i.identifier === prod);
  if (!master) throw new Error(`issue produksi ${prod} tidak ditemukan`);
  const project = (await j(`/companies/${company.id}/projects`))[0];
  const runs = await j(`/companies/${company.id}/heartbeat-runs?limit=300`);
  const ctxFor = (name) => {
    const ag = agents.find((x) => x.name === name);
    const run = runs.find((r) => r.agentId === ag.id);
    if (!run) throw new Error(`tidak ada run untuk ${name}`);
    return { companyId: company.id, agentId: ag.id, runId: run.id, projectId: project.id };
  };
  async function tool(name, parameters, who) {
    const r = await fetch(`${API}/plugins/tools/execute`, jb({ tool: `aao-approval-gate:${name}`, parameters, runContext: ctxFor(who) }));
    const x = await r.json().catch(() => ({}));
    return x.result?.data ?? x.result ?? x;
  }

  const research = readJson(path.join(dir, 'research-output.json'));
  const verification = readJson(path.join(dir, 'verification-result.json'));
  const carousel = readJson(path.join(dir, 'carousel.json'));
  const design = readJson(path.join(dir, 'carousel-design.json'));
  // Penjaga terakhir sebelum paket ke owner: semua gambar harus asli (manifest + bukti merek). Tidak ada gambar pengganti yang lolos.
  {
    const { checkAssets } = await import('./asset-gate.mjs');
    const templates = readJson(path.join(ROOT, 'divisions', 'edukasiai', 'brand', 'templates.json')).templates;
    const manifestFile = path.join(dir, 'assets-manifest.json');
    const assetErrors = checkAssets({ design, templates, manifest: existsSync(manifestFile) ? readJson(manifestFile) : null, identifier: runKey, carousel, rootDir: ROOT });
    if (assetErrors.length) throw new Error(`aset gambar tidak lolos: ${assetErrors.join(' | ').slice(0, 400)}`);
  }
  const qaFile = ['qa-result.json.accepted', 'qa-result.json'].map((f) => path.join(dir, f)).find((f) => existsSync(f));
  const llm = llmFromQaResult(qaFile ? readJson(qaFile) : null, { textOk: flag('--text-ok'), designOk: flag('--design-ok') });
  if (!llm) throw new Error('penilaian QA (llmReview.textOk/designOk) tidak ada; QA harus menulisnya, atau beri --text-ok/--design-ok secara sadar');
  const id = master.id;
  const qaAgent = agents.find((x) => x.name === 'QA'); const managerAgent = agents.find((x) => x.name === 'Manager');
  log(`produksi ${prod} (issue ${id.slice(0, 8)}); penilaian QA: ${JSON.stringify(llm)}`);

  // Handoff harus bertransisi dari in_progress. QA dipause sementara supaya penugasan ini tidak membangunkannya (pola yang sama dengan e2e-fixture).
  const wasQaStatus = qaAgent.status;
  if (wasQaStatus !== 'paused') await j(`/agents/${qaAgent.id}/pause`, jb({}));
  try {
  await fetch(`${API}/issues/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assigneeAgentId: qaAgent.id, status: 'in_progress' }) });
  // 1. documents on the production issue
  const existingDocs = await j(`/issues/${id}/documents`);
  const docList = Array.isArray(existingDocs) ? existingDocs : existingDocs.documents ?? [];
  for (const [key, body] of [['research-output', research], ['verification-result', verification], ['carousel', carousel], ['carousel-design', design]]) {
    const have = docList.find((d) => d.key === key);
    if (have) {
      // Plugin tidak mendukung pembaruan dokumen: bila isinya sama lewati (idempoten), bila beda hentikan dengan pesan jelas.
      let same = false; try { same = JSON.stringify(JSON.parse(have.body ?? have.latestBody ?? 'null')) === JSON.stringify(body); } catch { same = false; }
      if (same) { log(`attach ${key}: sudah ada (sama), dilewati`); continue; }
      throw new Error(`dokumen ${key} sudah ada di issue produksi dan berbeda; buat produksi baru, bukan menimpa`);
    }
    const r = await tool('attach_file', { issueId: id, key, body: JSON.stringify(body) }, 'Researcher');
    log(`attach ${key}: ${r.ok === true ? 'ok' : JSON.stringify(r).slice(0, 160)}`);
    if (r.ok !== true) throw new Error(`gagal melampirkan ${key}`);
  }
  // 2. deterministic verification records (code, not LLM)
  for (const t of verificationTargets(verification, research)) {
    const r = await tool('verify_candidate', { issueId: id, url: t.url, published_at: t.published_at, windowDays: verification.windowDays ?? 7 }, 'Verifier');
    log(`verify ${t.candidateId}: ${r.ok === true ? `url=${r.checks?.urlReachable?.ok} tanggal=${r.checks?.dateWithinWindow?.ok}` : JSON.stringify(r).slice(0, 160)}`);
  }
  // 3. render seal (the plugin RPC is capped at ~30 s on this machine; the worker keeps going, so we wait for the render to settle)
  const renderDir = path.join(ROOT, 'workspace', 'issues', id, 'render');
  const t0 = Date.now();
  const rr = await tool('render_carousel', { issueId: id, designPath: `agent/runs/${runKey}/carousel-design.json` }, 'Designer');
  log(`render_carousel: ${rr.sealed === true ? 'tersegel' : (rr.error ? 'RPC habis waktu, menunggu worker' : JSON.stringify(rr).slice(0, 160))}`);
  if (rr.sealed !== true) {
    let stable = 0; let last = '';
    for (let i = 0; i < 24 && stable < 3; i++) {
      await sleep(8000);
      const files = existsSync(renderDir) ? readdirSync(renderDir).filter((f) => /\.png$/.test(f)).map((f) => `${f}:${statSync(path.join(renderDir, f)).mtimeMs}`).join('|') : '';
      const fresh = files && readdirSync(renderDir).some((f) => statSync(path.join(renderDir, f)).mtimeMs >= t0 - 1000);
      if (fresh && files === last) stable += 1; else { stable = 0; last = files; }
    }
    await sleep(10000);
  }
  // 4. QA (retry while the seal is still being written)
  let qa;
  for (let i = 0; i < 6; i++) {
    qa = await tool('qa_submit_result', { issueId: id, llm }, 'QA');
    log(`qa_submit_result (${i + 1}): ${JSON.stringify(qa).slice(0, 260)}`);
    if (!/belum ada hasil render|segel/i.test(JSON.stringify(qa))) break;
    await sleep(15000);
  }
  if (qa?.action !== 'pass') { console.log(JSON.stringify({ ok: false, step: 'qa_submit_result', qa })); return 1; }
  // 5. hand-off
  const ho = await tool('handoff_to_owner', { issueId: id }, 'QA');
  log(`handoff_to_owner: ${JSON.stringify(ho).slice(0, 260)}`);
  if (ho.ok === true) {
    // Manager = pengelola: paket diserahkan ke Manager untuk laporan akhir; keputusan tetap di Owner (owner-decide).
    await fetch(`${API}/issues/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assigneeAgentId: managerAgent.id }) });
    log('diserahkan ke Manager untuk laporan akhir');
  }
  console.log(JSON.stringify({ ok: ho.ok === true, status: ho.status, contentHash: ho.contentHash, issue: prod, issueId: id }));
  return ho.ok === true ? 0 : 1;
  } finally {
    if (wasQaStatus !== 'paused') await j(`/agents/${qaAgent.id}/resume`, jb({})).catch(() => {});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { process.exitCode = await main().catch((e) => { console.log(JSON.stringify({ ok: false, error: String(e.message ?? e) })); return 1; }); }
