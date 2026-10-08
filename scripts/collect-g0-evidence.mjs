#!/usr/bin/env node
// collect-g0-evidence.mjs — mengambil bukti mentah AC0.2 dan AC0.5 dari server Paperclip.
//
// Dibuat untuk FIX-G0-01: reviewer G0 menemukan berkas bukti AC0.2 menunjuk run yang salah dan
// bukti mentah AC0.5 tidak ada di docs/spike/evidence/. Skrip ini membaca data yang MASIH ada
// di server (run, usage, cost-event, ledger biaya, log aktivitas) dan menulisnya apa adanya.
//
// Catatan kejujuran: ini pengambilan SESUDAH kejadian (post-hoc). Keadaan `paused` pada
// AC0.5 sudah dipulihkan, jadi yang tersimpan adalah jejaknya (cost-event, policy, log aktivitas),
// bukan tangkapan layar saat agent berstatus paused.
//
// Pemakaian: node scripts/collect-g0-evidence.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.PAPERCLIP_BASE ?? 'http://127.0.0.1:3177';
const EDU = 'e9986c83-2835-4f59-bd0f-d6d1b053f08d';
const RESEARCHER = 'e2b1bca8-fe6f-497c-a6b0-5882ce591877';
const RUN_OK = 'a80074bd-f018-4d2a-9dbc-e561d98e1020'; // run F0.2 yang succeeded 3m18s
const TEST_EVENT = '5ecdb924-f298-4757-b3bb-5bbc4a38d788'; // cost-event uji AC0.5 (D-004)

const outDir = path.join(root, 'docs', 'spike', 'evidence');
mkdirSync(outDir, { recursive: true });

async function get(p) {
  const res = await fetch(BASE + p);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* biarkan null */
  }
  return { status: res.status, json, text };
}

const list = (j, k) => (Array.isArray(j) ? j : Array.isArray(j?.[k]) ? j[k] : []);
const stamp = `Diambil post-hoc pada ${new Date().toISOString()} dari ${BASE}`;

// ── AC0.2 ─────────────────────────────────────────────────────────────────────
const runs = list((await get(`/api/companies/${EDU}/heartbeat-runs`)).json, 'runs');
const run = runs.find((r) => r.id === RUN_OK);
const byAgent = list((await get(`/api/companies/${EDU}/costs/by-agent`)).json, 'agents');
const researcherCost = byAgent.find((a) => a.agentId === RESEARCHER) ?? null;

const durSec =
  run?.startedAt && run?.finishedAt ? Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000) : null;

const ac02 = {
  catatan: stamp,
  klaim: 'AC0.2: 1 run agent selesai dengan biaya tercatat USD 0',
  run: run
    ? {
        id: run.id,
        status: run.status,
        exitCode: run.exitCode,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        durasiDetik: durSec,
        usage: run.usageJson
          ? {
              provider: run.usageJson.provider,
              biller: run.usageJson.biller,
              billingType: run.usageJson.billingType,
              costStatus: run.usageJson.costStatus,
              inputTokens: run.usageJson.inputTokens,
              outputTokens: run.usageJson.outputTokens,
              cachedInputTokens: run.usageJson.cachedInputTokens,
            }
          : null,
      }
    : 'RUN TIDAK DITEMUKAN DI SERVER',
  biayaPerAgent_Researcher: researcherCost,
  peringatan:
    'costs/by-agent mencakup juga cost-event sintetis uji AC0.5 (D-004) bila ada; lihat F0.5-budget-pause.json.',
};
writeFileSync(path.join(outDir, 'F0.2-run-succeeded.json'), JSON.stringify(ac02, null, 2) + '\n', 'utf8');

// ── AC0.5 ─────────────────────────────────────────────────────────────────────
const overview = (await get(`/api/companies/${EDU}/budgets/overview`)).json;
const policies = list(overview, 'policies').filter((p) => p.scopeId === RESEARCHER);
const events = list((await get(`/api/companies/${EDU}/costs/finance-events`)).json, 'events');
const activity = list((await get(`/api/companies/${EDU}/activity`)).json, 'activity');
const relevant = activity.filter((a) => /budget|pause|paused|hard.?stop|resume/i.test(JSON.stringify(a)));

const ac05 = {
  catatan: stamp,
  klaim: 'AC0.5: budget habis membuat agent berhenti (status paused)',
  keterbatasan: [
    'Biaya DISUNTIKKAN lewat POST /cost-events (biller "test-harness"); pemakaian nyata tercatat 0 (lihat F0.2-run-succeeded.json).',
    'Status paused sudah dipulihkan (resume) setelah uji, jadi berkas ini hanya memuat jejak, bukan tangkapan saat paused.',
    'Transkrip asli saat uji ada di reports/build/2026-10-05_F0.3-F0.5.md (bagian F0.5).',
  ],
  costEventUji: { id: TEST_EVENT },
  policyResearcherSaatIni: policies,
  logAktivitasTerkait: relevant.slice(0, 20),
  jumlahLogAktivitasDipindai: activity.length,
  financeEventsJumlah: events.length,
};
writeFileSync(path.join(outDir, 'F0.5-budget-pause.json'), JSON.stringify(ac05, null, 2) + '\n', 'utf8');

console.log('F0.2-run-succeeded.json  : run', run ? `${run.status} ${durSec}s billing=${run.usageJson?.billingType}` : 'TIDAK ADA');
console.log('F0.5-budget-pause.json   : policy', policies.length, '| log aktivitas terkait', relevant.length, 'dari', activity.length);
