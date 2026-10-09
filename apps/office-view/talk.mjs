// Talk panel backend (opt-in via --enable-talk). Lets the owner send a message to the division Manager from
// Office View. This is the ONLY write path in Office View: it creates an issue assigned to the Manager (or adds an
// owner comment to an issue created here). Loopback only, same-origin only, size and rate limited. No LLM here.
import { readdir, readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isStatusQuestion, buildStatusText, lastActivityFromLog, isResearchQuestion, buildResearchText, buildBriefAck } from './status.mjs';
import { STAGES, STAGE_AGENT } from '../../scripts/orchestrator-core.mjs';
import { decidePlanAction, planReplyText } from '../../scripts/owner-reply.mjs';
import { readOutbox } from '../../scripts/manager-outbox.mjs';

const MAX_TEXT = 4000;
const OUT_EXT = new Set(['.md', '.json', '.txt']);
const MAX_FILE = 200 * 1024;
const MIN_GAP_MS = 5000;

export function createTalk({ base, port, managerName = 'Manager', companyMatch = /edukasi/i, now = () => Date.now(), outputRoot = null, inboxRoot = null, stateFile = null, orchLogFile = null, netFile = null }) {
  const agentNames = new Map();
  const issues = new Set();
  let last = 0;
  let cache = null;

  const api = async (p, init = {}) => {
    const r = await fetch(base + '/api' + p, init);
    const t = await r.text();
    let j; try { j = JSON.parse(t); } catch { j = t; }
    if (!r.ok) throw new Error(`Paperclip ${r.status} ${typeof j === 'string' ? j.slice(0, 120) : (j?.error ?? '')}`);
    return j;
  };
  const post = (p, body) => api(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(body), 'utf8') });

  async function target() {
    if (cache) return cache;
    const company = (await api('/companies')).find((c) => companyMatch.test(c.name));
    if (!company) throw new Error('company EdukasiAI tidak ditemukan');
    const manager = (await api(`/companies/${company.id}/agents`)).find((a) => a.name === managerName);
    if (!manager) throw new Error(`agent ${managerName} tidak ditemukan`);
    const project = (await api(`/companies/${company.id}/projects`))[0];
    for (const a of await api(`/companies/${company.id}/agents`)) agentNames.set(a.id, a.name);
    cache = { companyId: company.id, managerId: manager.id, projectId: project?.id };
    return cache;
  }

  // Jawaban status instan dari data nyata (tanpa LLM). Setiap sumber gagal-aman: yang tidak terbaca dilewati, tidak membuat jawaban gagal.
  async function gatherStatus() {
    const nowMs = now();
    const readJson = async (f) => { try { return JSON.parse((await readFile(f, 'utf8')).replace(/^\uFEFF/, '')); } catch { return null; } };
    const st = stateFile ? await readJson(stateFile) : null;
    const job = st?.job ? { identifier: st.job.identifier, phase: st.job.phase, stageIndex: st.job.stageIndex, stageStartedMs: st.job.stageStartedMs } : null;
    const lastJob = !job && st?.history?.length ? { identifier: st.history[st.history.length - 1].identifier, phase: st.history[st.history.length - 1].phase } : null;
    const pending = (st?.pending ?? []).map((p) => ({ identifier: p.identifier, ready: !!p.ready }));
    let queue = 0; try { queue = (await readdir(inboxRoot)).filter((n) => /\.(md|txt|json)$/i.test(n)).length; } catch { /* tanpa inbox */ }
    const ns = netFile ? await readJson(netFile) : null;
    const net = ns && nowMs - (ns.updatedAtMs ?? 0) < 120_000 ? { offline: ns.hold === true, since: ns.since } : null;
    let agents = []; let activity = null;
    try {
      const t = await target();
      agents = (await api(`/companies/${t.companyId}/agents`)).map((a) => ({ name: a.name, status: a.status, model: a.adapterConfig?.model ?? '' }));
      if (job?.phase === 'running' && job.stageIndex >= 0) {
        const who = agents.find((a) => a.name === STAGE_AGENT[STAGES[job.stageIndex]]);
        const full = (await api(`/companies/${t.companyId}/agents`)).find((a) => a.name === who?.name);
        const runs = full ? (await api(`/companies/${t.companyId}/heartbeat-runs?limit=30`)).filter((r) => r.agentId === full.id && r.status === 'running') : [];
        if (runs[0]) { const lg = await api(`/heartbeat-runs/${runs[0].id}/log`); activity = lastActivityFromLog(lg?.content); }
      }
    } catch { /* Paperclip tidak terjangkau: tampilkan yang ada */ }
    let lastBlockLine = null;
    if (job?.phase === 'blocked' && orchLogFile) {
      try { const l = (await readFile(orchLogFile, 'utf8')).split(/\r?\n/).reverse().find((x) => x.includes('DIBLOKIR')); lastBlockLine = l ? l.replace(/^\S+\s+/, '').slice(0, 200) : null; } catch { /* tanpa log */ }
    }
    return { nowMs, job, lastJob, agents, net, activity, lastBlockLine, queue, pending };
  }

  // Berkas run terbaru (job berjalan atau terakhir) untuk menjawab pertanyaan hasil riset.
  async function gatherResearch() {
    const readJson = async (f) => { try { return JSON.parse((await readFile(f, 'utf8')).replace(/^﻿/, '')); } catch { return null; } };
    const st = stateFile ? await readJson(stateFile) : null;
    const ids = [st?.job && (st.job.runKey ?? st.job.identifier), ...(st?.history ?? []).map((h) => h.runKey ?? h.identifier).reverse()].filter(Boolean);
    for (const identifier of ids) {
      const dir = path.join(outputRoot ?? '', 'runs', ...String(identifier).split('/'));
      const research = await readJson(path.join(dir, 'research-output.json'));
      if (research?.candidates?.length) return { identifier, research, verification: await readJson(path.join(dir, 'verification-result.json')), carousel: await readJson(path.join(dir, 'carousel.json')) };
    }
    return { identifier: null, research: null, verification: null, carousel: null };
  }

  /**
   * Balasan owner terhadap rencana Manager yang ditahan (mode tinjau): "setuju" / "batal" / jawaban, diproses KODE tanpa membangkitkan Manager.
   * Mengembalikan teks balasan, atau null bila pesan bukan urusan rencana (lanjut ke chat biasa).
   */
  async function handlePlanReply(msg) {
    if (!stateFile || !outputRoot) return null;
    let st = null; try { st = JSON.parse((await readFile(stateFile, 'utf8')).replace(/^\uFEFF/, '')); } catch { return null; }
    const plans = (st?.pending ?? []).filter((p) => p.hold && p.ready).map((p) => ({ identifier: p.identifier, readyMs: p.readyMs }));
    if (!plans.length) return null;
    const qs = new Map();
    for (const p of plans) {
      try { const o = JSON.parse((await readFile(path.join(outputRoot, 'orders', p.identifier + '.json'), 'utf8')).replace(/^\uFEFF/, '')); qs.set(p.identifier, (o.ownerQuestions ?? []).length > 0); } catch { qs.set(p.identifier, false); }
    }
    const d = decidePlanAction({ text: msg, plans, hasQuestions: (id) => qs.get(id) === true });
    if (!d) return null;
    const dir = path.join(outputRoot, 'holds');
    await mkdir(dir, { recursive: true });
    const stamp = Date.now();
    if (d.note) await writeFile(path.join(dir, d.identifier + '.' + stamp + '.note'), JSON.stringify({ text: d.note, at: stamp }), 'utf8');
    if (d.action === 'approve') await writeFile(path.join(dir, d.identifier + '.release'), JSON.stringify({ at: stamp }), 'utf8');
    if (d.action === 'cancel') await writeFile(path.join(dir, d.identifier + '.cancel'), JSON.stringify({ at: stamp }), 'utf8');
    return planReplyText(d);
  }

  const sameOrigin = (req) => {
    const host = req.headers.host;
    if (host !== `127.0.0.1:${port}`) return false;
    const o = req.headers.origin;
    return !o || o === `http://127.0.0.1:${port}`;
  };

  async function readBody(req, limit = 32 * 1024) {
    const chunks = []; let n = 0;
    for await (const c of req) { n += c.length; if (n > limit) throw Object.assign(new Error('terlalu besar'), { code: 413 }); chunks.push(c); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  }

  /** Returns true when the request was handled here. */
  return async function handle(req, res, u, json) {
    if (!u.pathname.startsWith('/api/talk')) return false;
    try {
      if (u.pathname === '/api/talk/info' && req.method === 'GET') { json(res, 200, { enabled: true, to: managerName }); return true; }
      if (u.pathname === '/api/talk/status' && req.method === 'GET') { json(res, 200, { text: buildStatusText(await gatherStatus()) }); return true; }
      if (u.pathname === '/api/talk/outbox' && req.method === 'GET') {
        const after = Number(u.searchParams.get('after') ?? 0) || 0;
        json(res, 200, { messages: outputRoot ? readOutbox(path.join(outputRoot, 'chat'), after) : [] });
        return true;
      }
      if (u.pathname === '/api/talk/pipeline' && req.method === 'GET') {
        let job = null; let history = 0; let queue = 0;
        try { const s = JSON.parse((await readFile(stateFile, 'utf8')).replace(/^\uFEFF/, '')); job = s.job ? { identifier: s.job.identifier, phase: s.job.phase, stageIndex: s.job.stageIndex } : null; history = (s.history ?? []).length; } catch { /* belum ada state */ }
        try { queue = (await readdir(inboxRoot)).filter((n) => /\.(md|txt|json)$/i.test(n)).length; } catch { /* inbox belum ada */ }
        json(res, 200, { job, history, queue, pending: 0 });
        return true;
      }
      if (u.pathname === '/api/talk/outputs' && req.method === 'GET') {
        if (!outputRoot) { json(res, 200, { files: [] }); return true; }
        const walk = async (dir, rel = '') => {
          const out = [];
          for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
            const r = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory() && r.split('/').length < 3) out.push(...(await walk(path.join(dir, e.name), r)));
            else if (e.isFile() && OUT_EXT.has(path.extname(e.name).toLowerCase())) { const st = await stat(path.join(dir, e.name)); out.push({ path: r, size: st.size, mtime: st.mtimeMs }); }
          }
          return out;
        };
        json(res, 200, { files: (await walk(outputRoot)).sort((a, b) => b.mtime - a.mtime).slice(0, 40) });
        return true;
      }
      if (u.pathname === '/api/talk/file' && req.method === 'GET') {
        const rel = u.searchParams.get('path') ?? '';
        const abs = outputRoot ? path.resolve(outputRoot, rel) : null;
        if (!abs || !abs.startsWith(path.resolve(outputRoot) + path.sep) || !OUT_EXT.has(path.extname(abs).toLowerCase())) { json(res, 403, { error: 'path ditolak' }); return true; }
        const st = await stat(abs).catch(() => null);
        if (!st || !st.isFile() || st.size > MAX_FILE) { json(res, 404, { error: 'file tidak ada atau terlalu besar' }); return true; }
        json(res, 200, { path: rel, body: await readFile(abs, 'utf8') });
        return true;
      }
      if (u.pathname === '/api/talk/thread' && req.method === 'GET') {
        const id = u.searchParams.get('issue') ?? '';
        if (!issues.has(id)) { json(res, 404, { error: 'issue bukan dari panel ini' }); return true; }
        const [issue, comments] = await Promise.all([api(`/issues/${id}`), api(`/issues/${id}/comments`)]);
        json(res, 200, {
          issue: { id, identifier: issue.identifier, status: issue.status },
          comments: comments.slice().reverse().map((c) => ({
            from: c.authorType === 'system' ? 'Sistem' : c.authorAgentId ? (agentNames.get(c.authorAgentId) ?? managerName) : /^\[Orkestrator\]/.test(String(c.body ?? '')) ? 'Orkestrator' : 'Owner',
            kind: c.authorType === 'system' || (!c.authorAgentId && /^\[Orkestrator\]/.test(String(c.body ?? ''))) ? 'system' : c.authorAgentId ? 'agent' : 'owner',
            body: String(c.body ?? ''), at: c.createdAt,
          })),
        });
        return true;
      }
      if (u.pathname === '/api/talk/brief' && req.method === 'POST') {
        if (!sameOrigin(req)) { json(res, 403, { error: 'origin ditolak' }); return true; }
        if (!inboxRoot) { json(res, 503, { error: 'inbox tidak dikonfigurasi' }); return true; }
        const { name, text } = await readBody(req, 200 * 1024);
        const body = typeof text === 'string' ? text.trim() : '';
        if (!body || body.length > 150_000) { json(res, 400, { error: 'brief 1-150000 karakter' }); return true; }
        const safe = String(name ?? 'brief').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+/, '').slice(0, 60) || 'brief';
        const file = `${now()}-${safe.replace(/\.(md|txt|json)$/i, '')}.md`;
        await mkdir(inboxRoot, { recursive: true });
        // Balasan instan: posisi antrean dihitung SEBELUM brief ini ditulis (brief yang sudah antre di inbox + rencana yang sedang disusun)
        let st = null; try { st = JSON.parse((await readFile(stateFile, 'utf8')).replace(/^\uFEFF/, '')); } catch { /* belum ada state */ }
        let inboxAhead = 0; try { inboxAhead = (await readdir(inboxRoot)).filter((n) => /\.(md|txt|json)$/i.test(n)).length; } catch { /* inbox belum ada */ }
        await writeFile(path.join(inboxRoot, file), body, 'utf8');
        const ack = buildBriefAck({ job: st?.job ?? null, pending: (st?.pending ?? []).map((p) => ({ identifier: p.identifier, ready: !!p.ready })), inboxAhead });
        json(res, 200, { file, note: 'Brief masuk antrean.', ack });
        return true;
      }
      if (u.pathname === '/api/talk' && req.method === 'POST') {
        if (!sameOrigin(req)) { json(res, 403, { error: 'origin ditolak' }); return true; }
        if (now() - last < MIN_GAP_MS) { json(res, 429, { error: 'tunggu beberapa detik antar pesan' }); return true; }
        const { text, issueId } = await readBody(req);
        let msg = typeof text === 'string' ? text.trim() : '';
        // Pertanyaan progres dijawab instan dari data nyata (tanpa membangunkan Manager). "manager:" memaksa ke Manager.
        if (!issueId && isStatusQuestion(msg)) { json(res, 200, { kind: 'status', answer: buildStatusText(await gatherStatus()) }); return true; }
        if (!issueId && !/^manager\s*:/i.test(msg)) { const reply = await handlePlanReply(msg); if (reply) { json(res, 200, { kind: 'plan', answer: reply }); return true; } }
        // Pertanyaan tentang hasil riset (kandidat, untuk berapa konten) juga dijawab dari berkas nyata, bukan oleh LLM Manager.
        if (!issueId && outputRoot && isResearchQuestion(msg)) { json(res, 200, { kind: 'status', answer: buildResearchText(await gatherResearch()) }); return true; }
        msg = msg.replace(/^manager\s*:\s*/i, '');
        if (!msg || msg.length > MAX_TEXT) { json(res, 400, { error: `pesan 1-${MAX_TEXT} karakter` }); return true; }
        last = now();
        const t = await target();
        if (issueId) {
          if (!issues.has(issueId)) { json(res, 404, { error: 'issue bukan dari panel ini' }); return true; }
          await post(`/issues/${issueId}/comments`, { body: msg });
          json(res, 200, { issueId, kind: 'comment' });
          return true;
        }
        const issue = await post(`/companies/${t.companyId}/issues`, {
          title: `Arahan owner: ${msg.replace(/\s+/g, ' ').slice(0, 60)}`,
          description: msg, status: 'todo', projectId: t.projectId, assigneeAgentId: t.managerId,
        });
        issues.add(issue.id);
        json(res, 200, { issueId: issue.id, identifier: issue.identifier, kind: 'issue' });
        return true;
      }
      json(res, 405, { error: 'metode tidak didukung' });
      return true;
    } catch (e) {
      json(res, e.code === 413 ? 413 : 502, { error: String(e?.message ?? e) });
      return true;
    }
  };
}
