#!/usr/bin/env node
// aao-tool.mjs — command-line bridge so ANY adapter (opencode, gemini, codex) can call the aao-approval-gate
// plugin tools. Agents run:  node <repo>/divisions/edukasiai/tools/aao-tool.mjs <tool> '<json parameters>'
// It builds the HTTP request in code (UTF-8 byte-safe) and fills the run context from the agent's own env.
// Env used: PAPERCLIP_API_URL, PAPERCLIP_RUN_ID (set by Paperclip for every run), PAPERCLIP_TASK_ID (default issueId).
import { readFileSync } from 'node:fs';

const [tool, raw = '{}', ...rest] = process.argv.slice(2);
if (!tool) { console.error('Pemakaian: node aao-tool.mjs <tool> \'{"issueId":"..."}\' [--file params.json]'); process.exit(2); }
const API = (process.env.PAPERCLIP_API_URL ?? 'http://127.0.0.1:3177/api').replace(/\/$/, '');
const runId = process.env.PAPERCLIP_RUN_ID;
if (!runId) { console.log(JSON.stringify({ ok: false, error: 'PAPERCLIP_RUN_ID tidak ada; alat ini hanya jalan di dalam run agent' })); process.exit(1); }

let params;
try {
  const f = rest.indexOf('--file');
  params = JSON.parse(f >= 0 ? readFileSync(rest[f + 1], 'utf8') : raw);
} catch (e) { console.log(JSON.stringify({ ok: false, error: `parameter bukan JSON valid: ${e.message}` })); process.exit(1); }
if (!params.issueId && process.env.PAPERCLIP_TASK_ID && tool !== 'aao_hello') params.issueId = process.env.PAPERCLIP_TASK_ID;

const get = async (p) => (await fetch(API + p)).json();
const run = await get(`/heartbeat-runs/${runId}`);
let projectId;
if (params.issueId) projectId = (await get(`/issues/${params.issueId}`)).projectId;
projectId ??= (await get(`/companies/${run.companyId}/projects`))[0]?.id;

const body = Buffer.from(JSON.stringify({ tool: `aao-approval-gate:${tool}`, parameters: params, runContext: { companyId: run.companyId, agentId: run.agentId, runId, projectId } }), 'utf8');
const r = await fetch(`${API}/plugins/tools/execute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
const x = await r.json().catch(() => ({}));
console.log(JSON.stringify(x.result?.data ?? x.result ?? x));
process.exitCode = r.ok ? 0 : 1;
