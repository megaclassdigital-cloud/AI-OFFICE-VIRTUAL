// inspect.mjs — READ-ONLY inspection endpoints for the Office View dock (agent "memory", approvals, produced files).
// Only GET. Paperclip is read through GET as well. File access is confined to workspace/agent (no traversal), whitelisted extensions.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { activityTimeline } from './status.mjs';

const TEXT_EXT = new Set(['.json', '.md', '.txt']);
const IMG_EXT = new Set(['.png']);
const MAX_TEXT = 300 * 1024;
const MAX_IMG = 4 * 1024 * 1024;

/** Pure: resolve `rel` under `root`; null when it escapes the root or has a disallowed extension. */
export function safeJoin(root, rel, exts) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0')) return null;
  const base = path.resolve(root);
  const abs = path.resolve(base, rel);
  if (abs !== base && !abs.startsWith(base + path.sep)) return null;
  return exts.has(path.extname(abs).toLowerCase()) ? abs : null;
}

/** Pure: production id from a stage/master issue title ("EDU-27 · Verifier (…)" or "Produksi: …"). */
export function productionOf(title) {
  const m = String(title ?? '').match(/^(EDU-\d+)\s·\s([A-Za-z]+)/);
  return m ? { production: m[1], stage: m[2] } : null;
}

/** Pure: classify a Paperclip comment for display. */
export function commentKind(c, agentNames) {
  if (c.authorType === 'system') return { from: 'Sistem', kind: 'system' };
  if (c.authorAgentId) return { from: agentNames.get(c.authorAgentId) ?? 'Agen', kind: 'agent' };
  if (/^\[Orkestrator\]/.test(String(c.body ?? ''))) return { from: 'Orkestrator', kind: 'system' };
  return { from: 'Owner', kind: 'owner' };
}

export function createInspector({ base, outputRoot, stateFile = null, now = () => Date.now(), companyMatch = /edukasi/i }) {
  const api = async (p) => {
    const r = await fetch(base + '/api' + p);
    const t = await r.text();
    let j; try { j = JSON.parse(t); } catch { j = null; }
    if (!r.ok || j === null) throw new Error(`Paperclip ${r.status}`);
    return j;
  };
  let cache = null; let cachedAt = 0;
  async function ctx() {
    if (cache && now() - cachedAt < 8000) return cache;
    const company = (await api('/companies')).find((c) => companyMatch.test(c.name));
    if (!company) throw new Error('company EdukasiAI tidak ditemukan');
    const agents = await api(`/companies/${company.id}/agents`);
    cache = { companyId: company.id, agents, names: new Map(agents.map((a) => [a.id, a.name])) };
    cachedAt = now();
    return cache;
  }

  async function agentView(name) {
    const { companyId, agents, names } = await ctx();
    const agent = agents.find((a) => a.name.toLowerCase() === String(name).toLowerCase());
    if (!agent) return { status: 404, body: { error: 'agent tidak ada' } };
    const runs = (await api(`/companies/${companyId}/heartbeat-runs?limit=80`)).filter((r) => r.agentId === agent.id);
    const active = runs.find((r) => r.status === 'running') ?? null;
    const lastReal = runs.find((r) => !['cancelled', 'scheduled_retry'].includes(r.status)) ?? null;
    const logRun = active ?? lastReal;
    let timeline = [];
    if (logRun) { try { timeline = activityTimeline((await api(`/heartbeat-runs/${logRun.id}/log`))?.content, 30); } catch { /* log belum tersedia */ } }
    const issues = await api(`/companies/${companyId}/issues`);
    const mine = issues.filter((i) => i.assigneeAgentId === agent.id).sort((x, y) => Date.parse(y.updatedAt ?? 0) - Date.parse(x.updatedAt ?? 0));
    const current = mine.find((i) => ['in_progress', 'todo'].includes(i.status)) ?? mine[0] ?? null;
    let comments = [];
    if (current) {
      try { comments = (await api(`/issues/${current.id}/comments`)).filter((c) => c.authorAgentId === agent.id).slice(0, 5).map((c) => ({ at: c.createdAt, body: String(c.body ?? '').slice(0, 600) })); } catch { /* tanpa komentar */ }
    }
    return {
      status: 200,
      body: {
        agent: { name: agent.name, role: agent.role, title: agent.title, status: agent.status, adapterType: agent.adapterType, model: agent.adapterConfig?.model ?? null, pauseReason: agent.pauseReason ?? null },
        working: active ? { runId: active.id, startedAt: active.startedAt, elapsedMs: now() - Date.parse(active.startedAt ?? now()) } : null,
        issue: current ? { id: current.id, identifier: current.identifier, title: current.title, status: current.status } : null,
        timeline,
        timelineFrom: logRun ? { runId: logRun.id, status: logRun.status, live: !!active } : null,
        runs: runs.filter((r) => r.status !== 'scheduled_retry').slice(0, 8).map((r) => ({ id: r.id, status: r.status, startedAt: r.startedAt, finishedAt: r.finishedAt, error: r.error ? String(r.error).slice(0, 160) : null })),
        comments,
      },
    };
  }

  async function approvalsView() {
    const { companyId, names, agents } = await ctx();
    const issues = (await api(`/companies/${companyId}/issues`)).filter((i) => i.status === 'in_review').sort((x, y) => Date.parse(y.updatedAt ?? 0) - Date.parse(x.updatedAt ?? 0));
    let job = null;
    if (stateFile) { try { const s = JSON.parse((await readFile(stateFile, 'utf8')).replace(/^﻿/, '')); job = s.job ? { identifier: s.job.identifier, phase: s.job.phase, stageIndex: s.job.stageIndex } : null; } catch { /* belum ada */ } }
    return {
      status: 200,
      body: {
        job,
        items: issues.map((i) => ({ id: i.id, identifier: i.identifier, title: i.title, updatedAt: i.updatedAt, assignee: names.get(i.assigneeAgentId) ?? null, ...(productionOf(i.title) ?? {}) })),
        agents: agents.map((a) => a.name),
      },
    };
  }

  async function issueView(id) {
    const { names } = await ctx();
    const issue = await api(`/issues/${encodeURIComponent(id)}`);
    const comments = (await api(`/issues/${encodeURIComponent(id)}/comments`)).reverse().map((c) => ({ ...commentKind(c, names), at: c.createdAt, body: String(c.body ?? '').slice(0, 1500) }));
    return { status: 200, body: { identifier: issue.identifier, title: issue.title, status: issue.status, description: String(issue.description ?? '').slice(0, 4000), assignee: names.get(issue.assigneeAgentId) ?? null, comments, ...(productionOf(issue.title) ?? {}) } };
  }

  async function filesView(prod) {
    if (!/^EDU-\d+$/.test(prod ?? '')) return { status: 400, body: { error: 'id produksi tidak valid' } };
    const dir = path.join(outputRoot, 'runs', prod);
    const out = [];
    const walk = async (d, rel, depth) => {
      for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
        const r = `${rel}/${e.name}`;
        if (e.isDirectory() && depth < 2) await walk(path.join(d, e.name), r, depth + 1);
        else if (e.isFile()) {
          const ext = path.extname(e.name).toLowerCase();
          if (TEXT_EXT.has(ext) || IMG_EXT.has(ext)) { const st = await stat(path.join(d, e.name)); out.push({ path: r, size: st.size, mtime: st.mtimeMs, kind: IMG_EXT.has(ext) ? 'image' : 'text' }); }
        }
      }
    };
    await walk(dir, `runs/${prod}`, 0);
    return { status: 200, body: { files: out.sort((a, b) => a.path.localeCompare(b.path)) } };
  }

  /** Returns true when handled. */
  return async function handle(req, res, u, json, sendBuffer) {
    if (!u.pathname.startsWith('/api/inspect/')) return false;
    if (req.method !== 'GET') { json(res, 405, { error: 'hanya-baca' }); return true; }
    try {
      const p = u.pathname; const q = (k) => u.searchParams.get(k) ?? '';
      let r;
      if (p === '/api/inspect/agent') r = await agentView(q('name'));
      else if (p === '/api/inspect/approvals') r = await approvalsView();
      else if (p === '/api/inspect/issue') r = await issueView(q('id'));
      else if (p === '/api/inspect/files') r = await filesView(q('prod'));
      else if (p === '/api/inspect/file') {
        const abs = safeJoin(outputRoot, q('path'), TEXT_EXT);
        const st = abs ? await stat(abs).catch(() => null) : null;
        r = !abs ? { status: 403, body: { error: 'path ditolak' } } : !st || !st.isFile() || st.size > MAX_TEXT ? { status: 404, body: { error: 'tidak ada atau terlalu besar' } } : { status: 200, body: { path: q('path'), body: await readFile(abs, 'utf8') } };
      } else if (p === '/api/inspect/image') {
        const abs = safeJoin(outputRoot, q('path'), IMG_EXT);
        const st = abs ? await stat(abs).catch(() => null) : null;
        if (!abs) r = { status: 403, body: { error: 'path ditolak' } };
        else if (!st || !st.isFile() || st.size > MAX_IMG) r = { status: 404, body: { error: 'tidak ada atau terlalu besar' } };
        else { sendBuffer(res, 200, 'image/png', await readFile(abs)); return true; }
      } else r = { status: 404, body: { error: 'rute tidak ada' } };
      json(res, r.status, r.body);
    } catch (e) { json(res, 502, { error: String(e?.message ?? e) }); }
    return true;
  };
}
