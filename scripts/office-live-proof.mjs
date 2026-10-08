#!/usr/bin/env node
// office-live-proof.mjs — bukti LIVE Office View (U4.L, DoD #2): memicu SATU run nyata dan merekam karakter yang
// berjalan ke meja lalu kembali ke Lounge, serta mengukur jeda data Paperclip -> animasi.
//
// Aturan penghematan kuota: hanya satu issue ringan untuk agent QA. Begitu run selesai, issue langsung dibatalkan
// dan dilepas dari agent supaya Paperclip tidak membangunkan agent lagi. Skrip menolak jalan bila sudah ada run aktif.
//
// Pemakaian: node scripts/office-live-proof.mjs [--out docs/evidence/U4.L] [--agent QA] [--max-seconds 720]

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';

const a = process.argv.slice(2);
const arg = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const out = path.resolve(arg('--out', 'docs/evidence/U4.L'));
const API = arg('--api', 'http://127.0.0.1:3177/api');
const OFFICE = arg('--url', 'http://127.0.0.1:3190/');
const AGENT = arg('--agent', 'QA');
const MAX = Number(arg('--max-seconds', 720)) * 1000;
mkdirSync(out, { recursive: true });
const tmp = path.join(out, '_video-live');

const j = async (p, o) => { const r = await fetch(API + p, o); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const jb = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(body)) });

const company = (await j('/companies')).find((c) => /edukasi/i.test(c.name));
const agents = await j(`/companies/${company.id}/agents`);
const agent = agents.find((x) => x.name === AGENT);
if (!agent) throw new Error(`agent ${AGENT} tidak ditemukan`);
const runs0 = await j(`/companies/${company.id}/heartbeat-runs?limit=100`);
if (runs0.some((r) => ['running', 'queued'].includes(r.status))) throw new Error('sudah ada run aktif; tidak memicu run baru');
if (agent.status !== 'idle') throw new Error(`agent ${AGENT} berstatus ${agent.status}, bukan idle`);
const known = new Set(runs0.map((r) => r.id));
const project = (await j(`/companies/${company.id}/projects`))[0];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: tmp, size: { width: 1280, height: 720 } } });
const page = await ctx.newPage();
const consoleErrors = []; const requests = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(String(e)));
page.on('request', (r) => requests.push(r.url()));
await page.goto(OFFICE);
await page.waitForFunction(() => window.__office?.mode() === 'live' && window.__office.chars().some((c) => c.name === 'QA'), null, { timeout: 20000 });
const shots = [];
const shot = async (name) => { const f = `live-${String(shots.length + 1).padStart(2, '0')}-${name}.png`; await page.screenshot({ path: path.join(out, f) }); shots.push(f); };
await shot('sebelum-run-semua-di-lounge');

// ── picu SATU run nyata ──
const tTrigger = Date.now();
const issue = await j(`/companies/${company.id}/issues`, jb('POST', {
  title: 'Uji tampilan kantor (U4.L)',
  description: 'Ini uji tampilan kantor virtual, bukan tugas produksi. Cukup tulis satu komentar singkat berisi kata "siap" pada issue ini, lalu berhenti. Jangan melakukan hal lain.',
  status: 'todo', projectId: project.id, assigneeAgentId: agent.id,
}));
console.log(`issue ${issue.identifier} dibuat dan ditugaskan ke ${AGENT} @ ${new Date(tTrigger).toISOString()}`);

const log = [];
const mark = (what, extra = {}) => { const e = { at: Date.now(), t: ((Date.now() - tTrigger) / 1000).toFixed(1), what, ...extra }; log.push(e); console.log(`+${e.t}s ${what}`, extra.note ?? ''); return e; };
let run = null; let sawWorking = null; let sawMoving = null; let sawSeated = null; let sawIdle = null; let cancelled = false;
const deadline = Date.now() + MAX;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 400));
  const runs = await j(`/companies/${company.id}/heartbeat-runs?limit=20`);
  const mine = runs.find((r) => !known.has(r.id) && r.agentId === agent.id);
  if (mine && !run) { run = mine; mark('run terdeteksi di Paperclip', { runId: mine.id, startedAt: mine.startedAt, note: `status ${mine.status}` }); }
  if (run) run = runs.find((r) => r.id === run.id) ?? run;
  const ch = (await page.evaluate(() => window.__office.chars())).find((c) => c.name === AGENT);
  if (ch?.state === 'working' && !sawWorking) { sawWorking = mark('UI: state working diterima', { room: ch.room }); await shot('run-mulai-berjalan-ke-meja'); }
  if (ch?.moving && sawWorking && !sawMoving) sawMoving = mark('UI: karakter mulai berjalan', { room: ch.room });
  if (ch?.state === 'working' && !ch.moving && ch.room === 'qa' && !sawSeated) { sawSeated = mark('UI: karakter duduk di Meja QA, mengetik'); await shot('di-meja-qa-mengetik'); }
  if (run && ['succeeded', 'failed', 'error', 'timed_out', 'cancelled'].includes(run.status) && !cancelled) {
    mark('run selesai di Paperclip', { finishedAt: run.finishedAt, note: run.status });
    // hentikan siklus: batalkan issue + lepas assignee agar tidak ada run lanjutan
    await j(`/issues/${issue.id}`, jb('PATCH', { status: 'cancelled', assigneeAgentId: null }));
    cancelled = true; mark('issue dibatalkan dan dilepas (tidak ada run lanjutan)');
  }
  if (cancelled && ch?.state === 'idle' && !ch.moving && ch.room === 'lounge' && !sawIdle) { sawIdle = mark('UI: karakter kembali ke Lounge ☕'); await shot('run-selesai-kembali-ke-lounge'); break; }
  if (cancelled && ch?.state === 'failed' && !ch.moving && ch.room === 'bug') { sawIdle = mark('UI: karakter di Pojok Bug 🐞 (run gagal)'); await shot('run-gagal-pojok-bug'); break; }
}
// pastikan tidak ada run kedua
await new Promise((r) => setTimeout(r, 6000));
const runsAfter = (await j(`/companies/${company.id}/heartbeat-runs?limit=100`)).filter((r) => !known.has(r.id));
const finalState = await page.evaluate(() => ({ chars: window.__office.chars(), metrics: window.__office.metrics() }));
await shot('akhir');
const video = page.video();
await ctx.close();
renameSync(await video.path(), path.join(out, 'live-demo.webm'));
await browser.close();

const ms = (iso) => Date.parse(iso);
const startedAt = run?.startedAt ? ms(run.startedAt) : null;
const wMetric = finalState.metrics.find((m) => m.type === 'agent.state' && m.state === 'working' && m.agentId === agent.id);
const report = {
  issue: issue.identifier, agent: AGENT, triggerAt: new Date(tTrigger).toISOString(),
  run: run ? { id: run.id, status: run.status, startedAt: run.startedAt, finishedAt: run.finishedAt, tokens: run.usageJson ? { input: run.usageJson.inputTokens, output: run.usageJson.outputTokens, cached: run.usageJson.cachedInputTokens } : null } : null,
  runsCreated: runsAfter.length,
  latency: {
    bridgeObservedMinusRunStart_ms: wMetric && startedAt ? wMetric.observedAt - startedAt : null,
    uiAppliedMinusRunStart_ms: wMetric && startedAt ? wMetric.appliedAt - startedAt : null,
    uiMovingMinusRunStart_ms: sawMoving && startedAt ? sawMoving.at - startedAt : null,
    targetMs: 5000,
  },
  timeline: log, screenshots: shots, video: 'live-demo.webm', consoleErrors,
  networkOrigins: [...new Set(requests.map((u) => new URL(u).origin))],
};
writeFileSync(path.join(out, 'live-proof.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ runsCreated: report.runsCreated, latency: report.latency, consoleErrors: consoleErrors.length, networkOrigins: report.networkOrigins }, null, 2));
process.exit(report.runsCreated === 1 ? 0 : 3);
