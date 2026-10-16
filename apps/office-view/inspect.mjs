// inspect.mjs — READ-ONLY inspection endpoints for the Office View dock (agent "memory", approvals, produced files).
// Only GET. Paperclip is read through GET as well. File access is confined to workspace/agent (no traversal), whitelisted extensions.
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { activityTimeline } from './status.mjs';
import { summarizeProduction, productionStatus, cleanTitle } from './production.mjs';
import { CONTENT_RE, RUN_KEY_RE, runDirOf, runKeyFor, latestRunKey, listRevisions, masterIdentifierOf, labelOf, revisionOf } from '../../scripts/run-registry.mjs';

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

export function createInspector({ base, outputRoot, cacheFile = null, stateFile = null, now = () => Date.now(), companyMatch = /edukasi/i }) {
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
    // Jejak aktivitas: run yang sedang berjalan; bila tidak ada, run terbaru (apa pun statusnya) yang punya jejak (maks. 4 percobaan).
    const candidates = active ? [active] : runs.filter((r) => r.status !== 'scheduled_retry').slice(0, 4);
    let timeline = []; let logRun = null;
    for (const r of candidates) {
      try { const t = activityTimeline((await api(`/heartbeat-runs/${r.id}/log`))?.content, 30); if (t.length) { timeline = t; logRun = r; break; } } catch { /* log belum tersedia */ }
    }
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
        issue: current ? { id: current.id, identifier: current.identifier, title: current.title, status: current.status, description: String(current.description ?? '').slice(0, 4000) } : null,
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
        items: issues.map((i) => ({ id: i.id, identifier: i.identifier, title: i.title, updatedAt: i.updatedAt, assignee: names.get(i.assigneeAgentId) ?? null, package: /^(Produksi:|Revisi )/.test(String(i.title ?? '')), internal: /^EDU-[0-9]+ · [A-Za-z]+/.test(String(i.title ?? '')), ...(productionOf(i.title) ?? {}) })),
        agents: agents.map((a) => a.name),
      },
    };
  }

  /** Papan Admin Publikasi (baca-saja): status.json yang ditulis pekerja, ditambah riwayat ledger terakhir. */
  async function autopostView() {
    const dir = path.join(outputRoot, 'autopost');
    const status = await readJsonSafe(path.join(dir, 'status.json'));
    const ledger = (await readJsonSafe(path.join(dir, 'ledger.json'))) ?? [];
    const recent = ledger.slice(-12).reverse().map((e) => ({ content: e.content, platform: e.platform, mode: e.mode, status: e.status, at: e.at, error: e.error ? String(e.error).slice(0, 160) : null }));
    return { status: 200, body: { status, recent } };
  }

  async function issueView(id) {
    const { names } = await ctx();
    const issue = await api(`/issues/${encodeURIComponent(id)}`);
    const comments = (await api(`/issues/${encodeURIComponent(id)}/comments`)).reverse().map((c) => ({ ...commentKind(c, names), at: c.createdAt, body: String(c.body ?? '').slice(0, 1500) }));
    let documents = [];
    try { const dl = await api(`/issues/${encodeURIComponent(id)}/documents`); documents = (Array.isArray(dl) ? dl : dl.documents ?? []).map((x) => x.key); } catch { /* tanpa daftar dokumen */ }
    return { status: 200, body: { id, identifier: issue.identifier, title: issue.title, status: issue.status, description: String(issue.description ?? '').slice(0, 4000), assignee: names.get(issue.assigneeAgentId) ?? null, documents, comments, ...(productionOf(issue.title) ?? {}) } };
  }

  const readJsonSafe = async (abs) => { try { return JSON.parse((await readFile(abs, 'utf8')).replace(/^﻿/, '')); } catch { return null; } };
  // Kode konten (EDU-49) tidak berubah; revisi berada di runs/EDU-49/revision-N. "prod" dari UI = kode konten; "rev" opsional memilih versi (default terbaru).
  function resolveRun(prod, rev) {
    if (!CONTENT_RE.test(prod ?? '')) return null;
    const revs = listRevisions(outputRoot, prod);
    const wanted = rev !== undefined && rev !== '' && Number.isInteger(Number(rev)) ? Number(rev) : null;
    const runKey = wanted !== null && (wanted === 0 || revs.includes(wanted)) ? runKeyFor(prod, wanted) : latestRunKey(outputRoot, prod);
    return { contentId: prod, runKey, masterIdentifier: masterIdentifierOf(outputRoot, runKey), versions: [0, ...revs].map((n) => ({ rev: n, label: n === 0 ? 'asli' : `revisi ${n}` })) };
  }
  async function listRender(runKey) {
    const dir = path.join(runDirOf(outputRoot, runKey), 'render');
    return (await readdir(dir).catch(() => [])).filter((f) => /[.](png|json)$/.test(f)).map((f) => `runs/${runKey}/render/${f}`);
  }
  // Penahanan gambar asli (assets-hold.json berisi null bila tidak ada): daftar gambar yang belum terambil.
  async function readHold(dir) {
    const h = await readJsonSafe(path.join(dir, 'assets-hold.json'));
    return h && Array.isArray(h.missing) && h.missing.length ? h : null;
  }
  // Putaran QA yang sudah diarsipkan (runs/<ID>/arsip/qa-putaran-N-*/qa-result.json): riwayat kenapa revisi terjadi.
  async function readQaHistory(dir) {
    const base = path.join(dir, 'arsip');
    const out = [];
    for (const e of (await readdir(base, { withFileTypes: true }).catch(() => [])).filter((x) => x.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const q = await readJsonSafe(path.join(base, e.name, 'qa-result.json'));
      if (!q) continue;
      out.push({ round: e.name, passed: q.passed === true, returnTo: [].concat(q.returnTo ?? []), fromScratch: q.fromScratch === true, notes: (Array.isArray(q.notes) ? q.notes : [q.notes]).filter(Boolean).map((n) => String(n).slice(0, 320)).slice(0, 8) });
    }
    return out;
  }
  // Slide versi sebelumnya sebagai cadangan tampilan selama versi sekarang belum punya render (mis. revisi ditahan menunggu gambar). Selalu diberi label.
  async function prevSlidesFor(contentId, runKey) {
    const cur = revisionOf(runKey);
    const revs = [0, ...listRevisions(outputRoot, contentId)].filter((n) => n < cur).sort((a, b) => b - a);
    for (const n of revs) {
      const files = (await listRender(runKeyFor(contentId, n))).filter((x) => /slide-[0-9]+[.]png$/.test(x)).sort();
      if (files.length) return { label: n === 0 ? 'versi asli' : `revisi ${n}`, files };
    }
    return null;
  }
  async function masterOf(masterIdentifier, issues = null) {
    const { companyId } = await ctx();
    const master = (issues ?? (await api(`/companies/${companyId}/issues`))).find((i) => i.identifier === masterIdentifier) ?? null;
    let handoff = null;
    if (master && (!issues || !['cancelled', 'backlog'].includes(master.status))) {
      try { const dl = await api(`/issues/${master.id}/documents`); const d = (Array.isArray(dl) ? dl : dl.documents ?? []).find((x) => x.key === 'handoff'); if (d) { try { handoff = JSON.parse(d.body); } catch { handoff = {}; } } } catch { /* tanpa dokumen */ }
    }
    return { master, handoff };
  }
  async function activeJob() {
    if (!stateFile) return null;
    const s = await readJsonSafe(stateFile);
    return s?.job ?? null;
  }
  /** Job aktif (terdepan atau di jalur paralel) untuk sebuah issue master. */
  async function activeJobFor(masterIdentifier) {
    if (!stateFile) return null;
    const s = await readJsonSafe(stateFile);
    return [s?.job, ...(s?.followers ?? [])].find((j) => j && j.identifier === masterIdentifier) ?? null;
  }
  async function productionView(prod, rev) {
    const run = resolveRun(prod, rev);
    if (!run) return { status: 400, body: { error: 'id produksi tidak valid' } };
    const { runKey, masterIdentifier } = run;
    const dir = runDirOf(outputRoot, runKey);
    const [research, verification, carousel, design, qaAcc, qaMain, visualQa, order] = await Promise.all([
      readJsonSafe(path.join(dir, 'research-output.json')), readJsonSafe(path.join(dir, 'verification-result.json')), readJsonSafe(path.join(dir, 'carousel.json')),
      readJsonSafe(path.join(dir, 'carousel-design.json')), readJsonSafe(path.join(dir, 'qa-result.json.accepted')), readJsonSafe(path.join(dir, 'qa-result.json')),
      readJsonSafe(path.join(dir, 'render', 'visual-qa.json')), readJsonSafe(path.join(outputRoot, 'orders', `${masterIdentifier}.json`)),
    ]);
    let master = null; let handoff = null; let paperclipOk = true;
    try { ({ master, handoff } = await masterOf(masterIdentifier)); } catch { paperclipOk = false; }
    const mt = async (f) => (await stat(path.join(dir, f)).catch(() => null))?.mtimeMs ?? null;
    const mtimes = { manager: (await stat(path.join(outputRoot, 'orders', `${masterIdentifier}.json`)).catch(() => null))?.mtimeMs ?? null, researcher: await mt('research-output.json'), verifier: await mt('verification-result.json'), copywriter: await mt('carousel.json'), designer: await mt('carousel-design.json'), qa: await mt('qa-result.json.accepted') ?? await mt('qa-result.json') };
    const hold = await readHold(dir);
    const qaHistory = await readQaHistory(dir);
    const hasRender = (await listRender(runKey)).some((x) => /slide-01[.]png$/.test(x));
    const fallbackSlides = hasRender ? null : await prevSlidesFor(run.contentId, runKey);
    const aj = await activeJobFor(masterIdentifier);
    const job = aj ? { ...aj, identifier: run.contentId } : null; // summarizeProduction mencocokkan job dengan kode konten
    const view = summarizeProduction({ prod: run.contentId, order, research, verification, carousel, design, qa: qaAcc ?? qaMain, visualQa, master, handoff, job, renderFiles: await listRender(runKey), hold, fallbackSlides, qaHistory, mtimes, paperclipOk });
    return { status: 200, body: { ...view, runKey, revision: revisionOf(runKey), label: labelOf(runKey), versions: run.versions } };
  }
  /** Papan Tayang: tiga konten terbaru (versi terbaru tiap konten) dengan sampul dan status. */
  async function boardView(limit = 0) {
    const dirs = (await readdir(path.join(outputRoot, 'runs'), { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory() && CONTENT_RE.test(e.name));
    const withTime = await Promise.all(dirs.map(async (e) => {
      const key = latestRunKey(outputRoot, e.name);
      return { prod: e.name, runKey: key, t: (await stat(runDirOf(outputRoot, key)).catch(() => ({ mtimeMs: 0 }))).mtimeMs };
    }));
    const items = [];
    // Daftar penuh: SEMUA konten (tidak ada yang hilang dari TV), terbaru dibuat di atas. limit>0 = hanya yang paling baru aktif (papan di kanvas).
    let issueList = null;
    if (!limit) { try { const { companyId } = await ctx(); issueList = await api(`/companies/${companyId}/issues`); } catch { issueList = null; } }
    const ordered = withTime.sort((a, b) => b.t - a.t);
    for (const { prod, runKey } of limit ? ordered.slice(0, limit) : ordered) {
      const masterIdentifier = masterIdentifierOf(outputRoot, runKey);
      const render = await listRender(runKey);
      const slides = render.filter((f) => /slide-[0-9]+[.]png$/.test(f)).sort();
      const carousel = await readJsonSafe(path.join(runDirOf(outputRoot, runKey), 'carousel.json'));
      const order = await readJsonSafe(path.join(outputRoot, 'orders', `${masterIdentifier}.json`));
      let master = null; let handoff = null; let unknown = false;
      try { ({ master, handoff } = await masterOf(masterIdentifier, issueList)); } catch { unknown = true; }
      const runStat = await stat(runDirOf(outputRoot, runKey)).catch(() => null);
      const orderStat = await stat(path.join(outputRoot, 'orders', `${masterIdentifier}.json`)).catch(() => null);
      const createdMs = Date.parse(master?.createdAt ?? '') || orderStat?.birthtimeMs || orderStat?.mtimeMs || runStat?.birthtimeMs || runStat?.mtimeMs || 0;
      const holdB = await readHold(runDirOf(outputRoot, runKey));
      const fbB = slides.length ? null : await prevSlidesFor(prod, runKey);
      items.push({ createdAt: createdMs ? new Date(createdMs).toISOString() : null,  prod, runKey, revision: revisionOf(runKey), label: labelOf(runKey), title: cleanTitle(order?.title ?? carousel?.topic ?? prod), cover: slides[0] ?? fbB?.files?.[0] ?? null, coverFrom: slides.length ? null : (fbB?.label ?? null), slides: slides.length, caption: carousel?.caption ? String(carousel.caption).split(String.fromCharCode(10))[0].slice(0, 140) : null, status: productionStatus({ master, hasHandoff: !!handoff, job: await activeJobFor(masterIdentifier), unknown, holdCount: holdB?.missing?.length ?? 0 }) });
    }
    if (!limit) items.sort((a, b) => Date.parse(b.createdAt ?? 0) - Date.parse(a.createdAt ?? 0));
    // Riwayat tidak boleh hilang dari TV: simpan snapshot terakhir yang baik. Saat Paperclip error, status per konten memakai snapshot (bukan "tidak diketahui");
    // saat disk/berkas tidak terbaca sama sekali (daftar kosong), kembalikan snapshot apa adanya dengan penanda stale.
    const snap = cacheFile ? await readJsonSafe(cacheFile) : null;
    const snapBy = new Map((snap?.items ?? []).map((i) => [i.prod, i]));
    for (const it of items) { const old = snapBy.get(it.prod); if (old && it.status?.key === 'tidak_diketahui' && old.status) { it.status = { ...old.status, stale: true }; } }
    if (!limit && cacheFile && items.length >= (snap?.items?.length ?? 0) && !items.some((i) => i.status?.stale)) {
      try { await writeFile(cacheFile, JSON.stringify({ savedAt: new Date().toISOString(), items }, null, 2)); } catch { /* snapshot kosmetik */ }
    }
    if (!items.length && snap?.items?.length) return { status: 200, body: { items: limit ? snap.items.slice(0, limit) : snap.items, stale: true, cachedAt: snap.savedAt } };
    return { status: 200, body: { items } };
  }

  async function filesView(prod, rev) {
    const run = RUN_KEY_RE.test(prod ?? '') ? { runKey: prod } : resolveRun(prod, rev);
    if (!run) return { status: 400, body: { error: 'id produksi tidak valid' } };
    const dir = runDirOf(outputRoot, run.runKey);
    const out = [];
    const walk = async (d, rel, depth) => {
      for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
        const r = `${rel}/${e.name}`;
        if (e.isDirectory() && depth === 0 && /^revision-[0-9]+$/.test(e.name)) continue; // revisi punya daftar sendiri
        if (e.isDirectory() && depth < 2) await walk(path.join(d, e.name), r, depth + 1);
        else if (e.isFile()) {
          const ext = path.extname(e.name).toLowerCase();
          if (TEXT_EXT.has(ext) || IMG_EXT.has(ext)) { const st = await stat(path.join(d, e.name)); out.push({ path: r, size: st.size, mtime: st.mtimeMs, kind: IMG_EXT.has(ext) ? 'image' : 'text' }); }
        }
      }
    };
    await walk(dir, `runs/${run.runKey}`, 0);
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
      else if (p === '/api/inspect/autopost') r = await autopostView();
      else if (p === '/api/inspect/issue') r = await issueView(q('id'));
      else if (p === '/api/inspect/files') r = await filesView(q('prod'), q('rev'));
      else if (p === '/api/inspect/board') r = await boardView(Math.min(50, Math.max(0, parseInt(q('limit'), 10) || 0)));
      else if (p === '/api/inspect/production') r = await productionView(q('prod'), q('rev'));
      else if (p === '/api/inspect/file') {
        const abs = safeJoin(outputRoot, q('path'), TEXT_EXT);
        const st = abs ? await stat(abs).catch(() => null) : null;
        r = !abs ? { status: 403, body: { error: 'path ditolak' } } : !st || !st.isFile() || st.size > MAX_TEXT ? { status: 404, body: { error: 'tidak ada atau terlalu besar' } } : { status: 200, body: { path: q('path'), body: await readFile(abs, 'utf8') } };
      } else if (p === '/api/inspect/image') {
        const abs = safeJoin(outputRoot, q('path'), IMG_EXT);
        const st = abs ? await stat(abs).catch(() => null) : null;
        if (!abs) r = { status: 403, body: { error: 'path ditolak' } };
        else if (!st || !st.isFile() || st.size > MAX_IMG) r = { status: 404, body: { error: 'tidak ada atau terlalu besar' } };
        else {
          // ?download=1 -> diunduh sebagai SATU berkas gambar (nama: <produksi>-slide-NN.png), bukan gabungan.
          const name = path.basename(abs); const prodId = (q('path').match(/^runs[/](EDU-[0-9]+)[/]/) ?? [])[1];
          sendBuffer(res, 200, 'image/png', await readFile(abs), q('download') === '1' ? `${prodId ? prodId + '-' : ''}${name}` : undefined);
          return true;
        }
      } else r = { status: 404, body: { error: 'rute tidak ada' } };
      json(res, r.status, r.body);
    } catch (e) { json(res, 502, { error: String(e?.message ?? e) }); }
    return true;
  };
}
