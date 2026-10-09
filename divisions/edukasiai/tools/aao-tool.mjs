#!/usr/bin/env node
// aao-tool.mjs — command-line bridge so ANY adapter (opencode, gemini, codex) can call the aao-approval-gate
// plugin tools. Agents run:  node <repo>/divisions/edukasiai/tools/aao-tool.mjs <tool> '<json parameters>'
// It builds the HTTP request in code (UTF-8 byte-safe) and fills the run context from the agent's own env.
// Env used: PAPERCLIP_API_URL, PAPERCLIP_RUN_ID (set by Paperclip for every run), PAPERCLIP_TASK_ID (default issueId).
import { readFileSync } from 'node:fs';
import { parseCli } from './aao-cli.mjs';

const fail = (error, extra = {}) => { console.log(JSON.stringify({ ok: false, error, ...extra })); process.exit(1); };
const parsed = parseCli(process.argv.slice(2), (p) => readFileSync(p, 'utf8'));
if (parsed.error) fail(parsed.error);
const tool = parsed.tool;
const params = parsed.params;
// PAPERCLIP_API_URL di dalam run bisa berupa "http://host:port" atau "http://host:port/api". Coba keduanya lalu cadangan 127.0.0.1:3177;
// salah basis mengenai halaman UI (HTML), bukan API, jadi basis dipilih hanya bila /health menjawab JSON.
const envUrl = (process.env.PAPERCLIP_API_URL ?? '').trim().replace(/\/+$/, '');
const candidates = [...new Set([envUrl && (envUrl.endsWith('/api') ? envUrl : envUrl + '/api'), envUrl, 'http://127.0.0.1:3177/api'].filter(Boolean))];
let API = null; const tried = [];
for (const base of candidates) {
  try {
    const r = await fetch(base + '/health', { signal: AbortSignal.timeout(8000) });
    const t = await r.text();
    if (r.ok && t.trim().startsWith('{')) { API = base; break; }
    tried.push({ base, status: r.status, bodyStart: t.slice(0, 60) });
  } catch (e) { tried.push({ base, error: String(e.message ?? e).slice(0, 80) }); }
}
if (!API) fail('tidak menemukan API Paperclip yang menjawab JSON', { tried });
const runId = process.env.PAPERCLIP_RUN_ID;
if (!runId) { console.log(JSON.stringify({ ok: false, error: 'PAPERCLIP_RUN_ID tidak ada; alat ini hanya jalan di dalam run agent' })); process.exit(1); }

if (!params.issueId && process.env.PAPERCLIP_TASK_ID && tool !== 'aao_hello') params.issueId = process.env.PAPERCLIP_TASK_ID;

const getJson = async (p, init) => {
  const r = await fetch(API + p, init);
  const t = await r.text();
  try { return { status: r.status, ok: r.ok, data: JSON.parse(t) }; } catch { fail('respons bukan JSON', { status: r.status, url: API + p, bodyStart: t.slice(0, 80) }); }
};
const get = async (p) => (await getJson(p)).data;
const run = await get(`/heartbeat-runs/${runId}`);
let projectId;
if (params.issueId) projectId = (await get(`/issues/${params.issueId}`)).projectId;
projectId ??= (await get(`/companies/${run.companyId}/projects`))[0]?.id;

const body = Buffer.from(JSON.stringify({ tool: `aao-approval-gate:${tool}`, parameters: params, runContext: { companyId: run.companyId, agentId: run.agentId, runId, projectId } }), 'utf8');
const rr = await getJson('/plugins/tools/execute', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
const x = rr.data;
console.log(JSON.stringify(x.result?.data ?? x.result ?? x));
process.exitCode = rr.ok ? 0 : 1;
