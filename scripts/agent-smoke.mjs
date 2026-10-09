#!/usr/bin/env node
// agent-smoke.mjs — one tiny real run to confirm an agent's adapter works. Usage: node scripts/agent-smoke.mjs [--agent Researcher] [--prompt text] [--max-seconds 300]
const a = process.argv.slice(2);
const arg = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const API = 'http://127.0.0.1:3177/api';
const AGENT = arg('--agent', 'Researcher');
const PROMPT = arg('--prompt', null);
const MAX = Number(arg('--max-seconds', 300)) * 1000;
const j = async (p, o) => { const r = await fetch(API + p, o); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const jb = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(body)) });
const company = (await j('/companies')).find((c) => /edukasi/i.test(c.name));
const agent = (await j(`/companies/${company.id}/agents`)).find((x) => x.name === AGENT);
if (!agent || agent.status !== 'idle') throw new Error(`agent ${AGENT} tidak idle: ${agent?.status}`);
const runs0 = await j(`/companies/${company.id}/heartbeat-runs?limit=100`);
if (runs0.some((r) => ['running', 'queued'].includes(r.status))) throw new Error('sudah ada run aktif');
const known = new Set(runs0.map((r) => r.id));
const project = (await j(`/companies/${company.id}/projects`))[0];
const issue = await j(`/companies/${company.id}/issues`, jb('POST', {
  title: 'Uji adapter (smoke)', status: 'todo', projectId: project.id, assigneeAgentId: agent.id,
  description: PROMPT ?? 'Uji teknis, bukan tugas produksi. Tulis satu komentar singkat berisi kata "siap" lalu berhenti. Jangan melakukan hal lain.',
}));
let run = null; const t0 = Date.now();
while (Date.now() - t0 < MAX) {
  await new Promise((r) => setTimeout(r, 3000));
  const runs = await j(`/companies/${company.id}/heartbeat-runs?limit=20`);
  run = runs.find((r) => !known.has(r.id) && r.agentId === agent.id) ?? run;
  if (run && ['succeeded', 'failed', 'error', 'timed_out', 'cancelled'].includes(run.status)) break;
}
await j(`/issues/${issue.id}`, jb('PATCH', { status: 'cancelled', assigneeAgentId: null }));
const c = await j(`/issues/${issue.id}/comments`).catch(() => []);
console.log(JSON.stringify({ issue: issue.identifier, agent: AGENT, runStatus: run?.status ?? 'no-run', error: run?.error?.slice?.(0, 300), comment: Array.isArray(c) ? c.map((x) => String(x.body).slice(0, 200)) : c }, null, 1));
