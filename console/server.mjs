#!/usr/bin/env node
// Office Console — UI web read-only untuk AI Agent Office (permintaan owner 2026-10-08, spesifikasi awal bagian 24/26/27).
//
// Tidak mengubah Paperclip (ADR-0001): hanya MEMBACA API Paperclip dan berkas hasil di workspace/.
// Hanya GET. Mendengar di 127.0.0.1 saja. Tidak ada aksi tulis; approval baru dibangun di F2.1.
//
// Pemakaian: node console/server.mjs [--port 3180] [--paperclip http://127.0.0.1:3177]

import http from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const a = process.argv.slice(2);
const arg = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const PORT = Number(arg('--port', process.env.AAO_CONSOLE_PORT ?? 3180));
const PAPERCLIP = arg('--paperclip', process.env.AAO_API_BASE ?? 'http://127.0.0.1:3177').replace(/\/$/, '');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILE_RE = /^(slide-\d{2}\.png|contact-sheet\.png|visual-qa\.json|hashes\.json)$/;
// Company yang bukan milik loop (Office Mega Class) dan dummy uji (IsolationTest) tidak dibaca dan tidak ditampilkan (CLAUDE.md fakta 12).
const HIDDEN_COMPANY = /mega\s*class|isolation\s*test/i;
const PIPELINE_DOCS = ['research-output', 'verification-result', 'topic-selection', 'carousel', 'carousel-design', 'handoff'];

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json; charset=utf-8' };

const pc = async (p) => {
  const r = await fetch(`${PAPERCLIP}/api${p}`, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw Object.assign(new Error(`Paperclip ${r.status} ${p}`), { status: r.status });
  return r.json();
};
const safe = async (fn, fallback) => { try { return await fn(); } catch { return fallback; } };
const json = (res, code, body) => { const t = JSON.stringify(body); res.writeHead(code, { 'content-type': MIME['.json'], 'cache-control': 'no-store' }); res.end(t); };

async function visibleCompanies() {
  return (await pc('/companies')).filter((c) => !HIDDEN_COMPANY.test(c.name));
}
async function assertVisible(id) {
  if (!UUID_RE.test(id)) throw Object.assign(new Error('id tidak valid'), { status: 400 });
  const c = (await visibleCompanies()).find((x) => x.id === id);
  if (!c) throw Object.assign(new Error('division tidak ditemukan'), { status: 404 });
  return c;
}

async function loadLimits(company) {
  const slug = company.name.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const f = path.join(repoRoot, 'divisions', slug, 'limits.json');
  const lim = await safe(async () => JSON.parse((await readFile(f, 'utf8')).replace(/^﻿/, '')), null);
  return { source: lim ? `divisions/${slug}/limits.json` : 'bawaan', maxRunsPerAgentPerDay: lim?.maxRunsPerAgentPerDay ?? 6, maxMinutesPerAgentPerDay: lim?.maxMinutesPerAgentPerDay ?? 60, timezoneOffsetMinutes: lim?.timezoneOffsetMinutes ?? 420 };
}

function startOfLocalDay(nowMs, off) { return Math.floor((nowMs + off * 60_000) / 86_400_000) * 86_400_000 - off * 60_000; }

function usageOf(runs, agents, limits, nowMs = Date.now()) {
  const dayStart = startOfLocalDay(nowMs, limits.timezoneOffsetMinutes);
  const byAgent = new Map(agents.map((g) => [g.id, { agentId: g.id, name: g.name, role: g.role, todayRuns: 0, todayMinutes: 0, allRuns: 0, allMinutes: 0, input: 0, output: 0, cached: 0, failed: 0 }]));
  const days = new Map();
  for (const r of runs) {
    const u = byAgent.get(r.agentId);
    if (!u) continue;
    const s = Date.parse(r.startedAt ?? '');
    if (!Number.isFinite(s)) continue;
    const f = r.finishedAt ? Date.parse(r.finishedAt) : nowMs;
    const min = Math.max(0, ((Number.isFinite(f) ? f : nowMs) - s) / 60_000);
    const uj = r.usageJson ?? {};
    u.allRuns += 1; u.allMinutes += min;
    u.input += Number(uj.inputTokens ?? 0); u.output += Number(uj.outputTokens ?? 0); u.cached += Number(uj.cachedInputTokens ?? 0);
    if (r.status && r.status !== 'succeeded' && r.status !== 'running' && r.status !== 'queued') u.failed += 1;
    if (s >= dayStart && s <= nowMs) { u.todayRuns += 1; u.todayMinutes += min; }
    const dk = new Date(s + limits.timezoneOffsetMinutes * 60_000).toISOString().slice(0, 10);
    const d = days.get(dk) ?? { date: dk, runs: 0, minutes: 0, input: 0, output: 0, cached: 0 };
    d.runs += 1; d.minutes += min; d.input += Number(uj.inputTokens ?? 0); d.output += Number(uj.outputTokens ?? 0); d.cached += Number(uj.cachedInputTokens ?? 0);
    days.set(dk, d);
  }
  const round = (n) => Math.round(n * 10) / 10;
  const agentsOut = [...byAgent.values()].map((u) => ({ ...u, todayMinutes: round(u.todayMinutes), allMinutes: round(u.allMinutes) }));
  const total = agentsOut.reduce((t, u) => ({ runs: t.runs + u.allRuns, minutes: t.minutes + u.allMinutes, input: t.input + u.input, output: t.output + u.output, cached: t.cached + u.cached }), { runs: 0, minutes: 0, input: 0, output: 0, cached: 0 });
  return { limits, agents: agentsOut, days: [...days.values()].sort((x, y) => (x.date < y.date ? 1 : -1)).slice(0, 14).map((d) => ({ ...d, minutes: round(d.minutes) })), total: { ...total, minutes: round(total.minutes) } };
}

async function renderInfo(issueId) {
  const dir = path.join(repoRoot, 'workspace', 'issues', issueId, 'render');
  const files = await safe(() => readdir(dir), []);
  if (!files.length) return null;
  const hashes = await safe(async () => JSON.parse(await readFile(path.join(dir, 'hashes.json'), 'utf8')), null);
  const qa = await safe(async () => JSON.parse(await readFile(path.join(dir, 'visual-qa.json'), 'utf8')), null);
  return {
    slides: files.filter((f) => /^slide-\d{2}\.png$/.test(f)).sort(),
    contactSheet: files.includes('contact-sheet.png'),
    hashes,
    visualQa: qa ? { passed: qa.passed, slideCount: qa.slideCount, pngCount: qa.pngCount, thresholds: qa.thresholds ?? null, failed: qa.slides.filter((s) => !s.passed).map((s) => s.index) } : null,
  };
}

async function stageOf(issue) {
  const docs = await safe(() => pc(`/issues/${issue.id}/documents`), []);
  const keys = new Set((Array.isArray(docs) ? docs : docs.documents ?? []).map((d) => d.key));
  const render = await renderInfo(issue.id);
  const steps = [
    { key: 'research', label: 'Riset', done: keys.has('research-output') },
    { key: 'verification', label: 'Verifikasi', done: keys.has('verification-result') },
    { key: 'topic', label: 'Topik', done: keys.has('topic-selection') },
    { key: 'copy', label: 'Teks', done: keys.has('carousel') },
    { key: 'design', label: 'Desain', done: keys.has('carousel-design') },
    { key: 'render', label: 'Render', done: !!render?.slides.length },
    { key: 'qa', label: 'QA', done: !!render?.visualQa?.passed && keys.has('handoff') },
    { key: 'approval', label: 'Approval owner', done: issue.status === 'done' },
  ];
  const awaiting = issue.status === 'in_review';
  return { steps, documents: [...keys].sort(), render, awaitingOwner: awaiting };
}

async function divisionDetail(company) {
  const [agents, issues, runs, activity, dashboard, projects, limits] = await Promise.all([
    safe(() => pc(`/companies/${company.id}/agents`), []),
    safe(() => pc(`/companies/${company.id}/issues`), []),
    safe(() => pc(`/companies/${company.id}/heartbeat-runs?limit=500`), []),
    safe(() => pc(`/companies/${company.id}/activity?limit=60`), []),
    safe(() => pc(`/companies/${company.id}/dashboard`), null),
    safe(() => pc(`/companies/${company.id}/projects`), []),
    loadLimits(company),
  ]);
  const agentName = new Map(agents.map((g) => [g.id, g.name]));
  const usage = usageOf(runs, agents, limits);
  const usageByAgent = new Map(usage.agents.map((u) => [u.agentId, u]));
  const tasks = await Promise.all(issues.map(async (i) => ({
    id: i.id, identifier: i.identifier, title: i.title, status: i.status, priority: i.priority,
    assignee: i.assigneeAgentId ? agentName.get(i.assigneeAgentId) ?? i.assigneeAgentId : null,
    createdAt: i.createdAt, updatedAt: i.updatedAt, completedAt: i.completedAt, activeRun: !!i.activeRun,
    workflow: await stageOf(i),
  })));
  return {
    company: { id: company.id, name: company.name, description: company.description ?? null, status: company.status ?? null },
    dashboard,
    projects: projects.map((p) => ({ id: p.id, name: p.name, status: p.status })),
    agents: agents.map((g) => {
      const u = usageByAgent.get(g.id);
      return {
        id: g.id, name: g.name, role: g.role, title: g.title, status: g.status, adapter: g.adapterType,
        timeoutSec: g.adapterConfig?.timeoutSec ?? null, lastHeartbeatAt: g.lastHeartbeatAt, pauseReason: g.pauseReason,
        budgetMonthlyCents: g.budgetMonthlyCents, spentMonthlyCents: g.spentMonthlyCents, today: u ? { runs: u.todayRuns, minutes: u.todayMinutes } : null,
      };
    }),
    tasks: tasks.sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1)),
    usage,
    audit: activity.map((e) => ({ id: e.id, at: e.createdAt, actor: e.actorType === 'agent' ? agentName.get(e.actorId) ?? 'agent' : e.actorType === 'plugin' ? `plugin:${e.actorId}` : e.actorId, action: e.action, entity: `${e.entityType}${e.entityId ? ':' + String(e.entityId).slice(0, 8) : ''}`, details: e.details ?? null })),
  };
}

async function issueDetail(id) {
  if (!UUID_RE.test(id)) throw Object.assign(new Error('id tidak valid'), { status: 400 });
  const issue = await pc(`/issues/${id}`);
  const company = await assertVisible(issue.companyId);
  const docList = await safe(() => pc(`/issues/${id}/documents`), []);
  const keys = (Array.isArray(docList) ? docList : docList.documents ?? []).map((d) => d.key).sort();
  const documents = {};
  for (const k of keys) {
    const d = await safe(() => pc(`/issues/${id}/documents/${encodeURIComponent(k)}`), null);
    const body = typeof d?.body === 'string' ? d.body : '';
    documents[k] = body.length > 60_000 ? `${body.slice(0, 60_000)}\n… (dipotong)` : body;
  }
  const comments = await safe(() => pc(`/issues/${id}/comments`), []);
  const list = Array.isArray(comments) ? comments : comments.comments ?? [];
  return {
    company: company.name,
    issue: { id: issue.id, identifier: issue.identifier, title: issue.title, status: issue.status, description: issue.description ?? '' },
    workflow: await stageOf(issue),
    documents,
    comments: list.map((c) => ({ at: c.createdAt, author: c.authorAgentId ? 'agent' : c.authorUserId ?? 'sistem', body: String(c.body ?? '').slice(0, 4000) })),
  };
}

async function serveStatic(res, rel) {
  const file = path.join(here, 'public', rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(path.join(here, 'public') + path.sep)) return json(res, 403, { error: 'dilarang' });
  try {
    const buf = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(buf);
  } catch { json(res, 404, { error: 'tidak ada' }); }
}

export const server = http.createServer(async (req, res) => {
  try {
    if (req.method !== 'GET') return json(res, 405, { error: 'Console ini read-only' });
    const u = new URL(req.url, 'http://localhost');
    const p = u.pathname;
    if (p === '/api/health') return json(res, 200, { ok: true, paperclip: PAPERCLIP, health: await safe(() => pc('/health'), null) });
    if (p === '/api/office') {
      const [health, companies] = await Promise.all([safe(() => pc('/health'), null), visibleCompanies()]);
      const divisions = await Promise.all(companies.map(async (c) => {
        const [d, agents] = await Promise.all([safe(() => pc(`/companies/${c.id}/dashboard`), null), safe(() => pc(`/companies/${c.id}/agents`), [])]);
        return { id: c.id, name: c.name, description: c.description ?? null, agents: agents.length, dashboard: d };
      }));
      return json(res, 200, { paperclip: PAPERCLIP, health, divisions, generatedAt: new Date().toISOString() });
    }
    let m;
    if ((m = /^\/api\/division\/([^/]+)$/.exec(p))) return json(res, 200, await divisionDetail(await assertVisible(m[1])));
    if ((m = /^\/api\/issue\/([^/]+)$/.exec(p))) return json(res, 200, await issueDetail(m[1]));
    if ((m = /^\/api\/file\/([^/]+)\/([^/]+)$/.exec(p))) {
      const [, id, name] = m;
      if (!UUID_RE.test(id) || !FILE_RE.test(name)) return json(res, 400, { error: 'berkas tidak valid' });
      const f = path.join(repoRoot, 'workspace', 'issues', id, 'render', name);
      const st = await stat(f).catch(() => null);
      if (!st?.isFile()) return json(res, 404, { error: 'tidak ada' });
      res.writeHead(200, { 'content-type': MIME[path.extname(name)], 'cache-control': 'no-store' });
      return res.end(await readFile(f));
    }
    if (p.startsWith('/api/')) return json(res, 404, { error: 'rute tidak ada' });
    if (p === '/brand/logo.png') {
      const f = path.join(repoRoot, 'divisions', 'edukasiai', 'brand', 'logo', 'edukasiai-logo.png');
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(await readFile(f));
    }
    if (p === '/pipeline.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(await readFile(path.join(repoRoot, 'docs', 'pipeline-edukasiai.png')));
    }
    return serveStatic(res, p);
  } catch (e) {
    json(res, e.status ?? 502, { error: e.status ? e.message : `Paperclip tidak dapat dihubungi: ${e.message}` });
  }
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(PORT, '127.0.0.1', () => console.log(`Office Console: http://127.0.0.1:${PORT}  (Paperclip ${PAPERCLIP}, read-only)`));
}
