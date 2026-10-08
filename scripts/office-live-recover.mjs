#!/usr/bin/env node
// office-live-recover.mjs — bukti LIVE kedua (U4.L), TANPA run LLM: perubahan status agent nyata di Paperclip
// (pause lalu resume lewat API) harus menggerakkan karakter di Office View, dengan jeda diukur.
//
//   Jika agent berstatus `error` : resume -> karakter keluar dari Pojok Bug dan kembali ke Lounge.
//   Jika agent `idle`            : pause  -> berjalan ke mejanya dan tertidur 😴; resume -> kembali ke Lounge ☕.
//
// Pemakaian: node scripts/office-live-recover.mjs [--out docs/evidence/U4.L] [--agent QA]

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';

const a = process.argv.slice(2);
const arg = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const out = path.resolve(arg('--out', 'docs/evidence/U4.L'));
const API = arg('--api', 'http://127.0.0.1:3177/api');
const AGENT = arg('--agent', 'QA');
mkdirSync(out, { recursive: true });
const j = async (p, o) => { const r = await fetch(API + p, o); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const post = (p) => j(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });

const company = (await j('/companies')).find((c) => /edukasi/i.test(c.name));
const agent = (await j(`/companies/${company.id}/agents`)).find((x) => x.name === AGENT);
const startStatus = agent.status;
if (!['idle', 'error'].includes(startStatus)) throw new Error(`agent ${AGENT} berstatus ${startStatus}`);
const runsBefore = (await j(`/companies/${company.id}/heartbeat-runs?limit=100`)).length;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: path.join(out, '_video-recover'), size: { width: 1280, height: 720 } } });
const page = await ctx.newPage();
const errors = []; const requests = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
page.on('request', (r) => requests.push(r.url()));
await page.goto('http://127.0.0.1:3190/');
await page.waitForFunction((n) => window.__office?.chars().some((c) => c.name === n), AGENT, { timeout: 20000 });
await page.waitForTimeout(1500);
const me = () => page.evaluate((n) => window.__office.chars().find((c) => c.name === n), AGENT);
const shots = [];
const shot = async (n) => { const f = `recover-${String(shots.length + 1).padStart(2, '0')}-${n}.png`; await page.screenshot({ path: path.join(out, f) }); shots.push(f); };
const before = await me();
await shot(startStatus === 'error' ? 'awal-qa-di-pojok-bug-snapshot' : 'awal-qa-di-lounge');

/** Picu perubahan, lalu amati sampai `done(c)` benar; kembalikan waktu tiap tonggak (ms sejak pemicu). */
async function phase(label, trigger, wantState, doneRoom) {
  const t0 = Date.now(); const r = await trigger();
  const m = { label, apiStatus: r.status ?? null }; let shotApplied = false;
  for (let i = 0; i < 500; i++) {
    await page.waitForTimeout(100);
    const c = await me();
    if (c.state === wantState && m.stateAppliedMs === undefined) { m.stateAppliedMs = Date.now() - t0; if (!shotApplied) { shotApplied = true; await shot(`${label}-state-diterima`); } }
    if (m.stateAppliedMs !== undefined && c.moving && m.walkingMs === undefined) m.walkingMs = Date.now() - t0;
    if (m.stateAppliedMs !== undefined && !c.moving && c.room === doneRoom) { m.arrivedMs = Date.now() - t0; m.finalRoom = c.room; m.bubble = c.bubble; break; }
  }
  await shot(`${label}-selesai`);
  const metric = (await page.evaluate(() => window.__office.metrics())).filter((x) => x.agentId === agent.id && x.state === wantState).at(-1);
  if (metric) { m.bridgeObservedMs = metric.observedAt - t0; m.uiAppliedMs = metric.appliedAt - t0; }
  return m;
}

const phases = [];
if (startStatus === 'idle') phases.push(await phase('pause', () => post(`/agents/${agent.id}/pause`), 'paused', 'qa'));
phases.push(await phase('resume', () => post(`/agents/${agent.id}/resume`), 'idle', 'lounge'));

const runsAfter = (await j(`/companies/${company.id}/heartbeat-runs?limit=100`)).length;
const final = await j(`/agents/${agent.id}`);
const video = page.video();
await ctx.close();
renameSync(await video.path(), path.join(out, 'recover-demo.webm'));
await browser.close();

const report = { agent: AGENT, startStatus, endStatus: final.status, before, phases, newRuns: runsAfter - runsBefore, targetMs: 5000, screenshots: shots, video: 'recover-demo.webm', consoleErrors: errors, networkOrigins: [...new Set(requests.map((u) => new URL(u).origin))] };
writeFileSync(path.join(out, 'recover-proof.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ startStatus, endStatus: report.endStatus, newRuns: report.newRuns, phases, consoleErrors: errors.length, networkOrigins: report.networkOrigins }, null, 2));
process.exit(report.newRuns === 0 && report.endStatus === 'idle' ? 0 : 3);
