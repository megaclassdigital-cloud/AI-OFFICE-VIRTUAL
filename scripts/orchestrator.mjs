#!/usr/bin/env node
// orchestrator.mjs — runs the production pipeline from an owner brief. Deterministic; the Manager (LLM) only
// writes the work order. One job at a time (protects free-tier quotas).
//   Drop a brief (.md/.txt/.json) into workspace/inbox/  (or upload it in the Office View panel), then:
//   node scripts/orchestrator.mjs --watch [--interval 15]     |  --once  |  --dry-run  |  --status
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, appendFileSync, copyFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { writeHeartbeat, waitForPaperclip, isConnectionError, acquireLock, releaseLock } from './heartbeat.mjs';
import { laneOf, decideAdvance, canPromote, LIMITS, normalizeOrderFileNames, isManagerRetryable, MAX_PENDING_PLANS, checkOrderStructure, extraContentsOf, renderAnalysisComment, runKeyOf, canPlanAhead, nextPlanned, activePending, STAGES, STAGE_AGENT, STAGE_OUTPUT, parseRevisionBrief, validateOrder, newJob, step, stageDescription, outputPath, artifactPath, checkQaResult, forwardSlashPaths, isNetworkError as isNetworkErr } from './orchestrator-core.mjs';
import { normalizeResearch } from './normalize-research.mjs';
import { probe, decide, writeNetworkState, readNetworkState } from './netcheck.mjs';
import { notifyOwner } from './notify.mjs';
import { validate } from '../schemas/validate.mjs';
import { contentOf, revisionOf, runDirOf, nextRunKey, writeRunMeta, runKeyForMaster, labelOf, latestRunKey, CONTENT_RE } from './run-registry.mjs';
import { renderManagerContext, startOfDayWib } from './manager-context.mjs';
import { appendOutbox, buildPlanMessage, speakerName } from './manager-outbox.mjs';
import { buildManagerInstruction } from './manager-instruction.mjs';
import { resolveRouting, buildRevisionBrief, routingDirFor, managerFile, cancelFile, doneFile } from './revision-router.mjs';
import { imageSlotsUsed, matchRequests, manifestVerdict, checkAssets, holdMessage, inboxSignature, shouldRetryCapture, readHold, writeHold } from './asset-gate.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const INBOX = path.join(ROOT, 'workspace', 'inbox');
const PROCESSED = path.join(INBOX, 'processed');
const OUTPUTS = path.join(ROOT, 'workspace', 'agent');
const ORDERS = path.join(OUTPUTS, 'orders');
const STATE = path.join(ROOT, 'workspace', 'orchestrator-state.json');
const LOG = path.join(ROOT, 'reports', 'orchestrator.log');
const BRIEF_EXT = new Set(['.md', '.txt', '.json']);
const MAX_BRIEF = 200 * 1024;

const a = process.argv.slice(2);
const arg = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const API = arg('--api', 'http://127.0.0.1:3177/api');
const DRY = a.includes('--dry-run');

const log = (m) => { const l = `${new Date().toISOString()} ${m}`; console.log(l); mkdirSync(path.dirname(LOG), { recursive: true }); appendFileSync(LOG, l + '\n'); };
const j = async (p, o) => { const r = await fetch(API + p, o); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const jb = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(body), 'utf8') });
const readState = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { job: null, history: [], pending: [] });
const writeState = (s) => { mkdirSync(path.dirname(STATE), { recursive: true }); writeFileSync(STATE, JSON.stringify(s, null, 2)); };

if (!(await waitForPaperclip(API, { log, maxMs: a.includes('--watch') ? 20 * 60_000 : 0 })) && a.includes('--watch')) { log('Paperclip tidak siap dalam 20 menit; keluar agar pengawas memulai ulang'); process.exit(1); }
const company = (await j('/companies')).find((c) => /edukasi/i.test(c.name));
if (!company) throw new Error('company EdukasiAI tidak ditemukan');
const agents = await j(`/companies/${company.id}/agents`);
const agentByName = (n) => agents.find((x) => x.name === n);
const project = (await j(`/companies/${company.id}/projects`))[0];

// Brief tetap per tahap (mis. design system untuk Designer): dilampirkan otomatis pada setiap produksi.
const STANDING_REFS = { designer: [path.join(ROOT, 'divisions', 'edukasiai', 'brand', 'briefs', 'design-system.md')] };
const standingRefs = (stage) => (STANDING_REFS[stage] ?? []).filter((p) => existsSync(p));

const outPathFor = (identifier, stage) => outputPath(OUTPUTS, identifier, stage, path.sep);
const artifactPathFor = (identifier, stage) => artifactPath(OUTPUTS, identifier, stage, path.sep);

const TEMPLATES = (() => { try { return JSON.parse(readFileSync(path.join(ROOT, 'divisions', 'edukasiai', 'brand', 'templates.json'), 'utf8').replace(/^﻿/, '')).templates; } catch { return {}; } })();

/**
 * Gerbang aset gambar (KODE): desain yang memakai gambar runs/<ID>/assets/* wajib punya asset-requests.json yang cocok;
 * kode mengambil gambarnya (screenshot pencarian gambar / inbox owner). Belum lengkap => TAHAN (hold), bukan gambar pengganti.
 * Mengembalikan null bila aman lanjut ke render, atau hasil gerbang { ok:false, ... }.
 */
function assetGate(job, design, designPath) {
  const used = imageSlotsUsed(design, TEMPLATES, runKeyOf(job));
  if (!used.length) return null;
  const runDir = path.dirname(designPath);
  const reqFile = path.join(runDir, 'asset-requests.json');
  if (!existsSync(reqFile)) return { ok: false, errors: [`desain memakai gambar tetapi ${reqFile} belum ada. Tulis permintaan aset (skema asset-requests: slide, file, kind photo|brand|product, query) untuk tiap gambar, lalu panggil complete_stage lagi.`] };
  let doc;
  try { doc = JSON.parse(readFileSync(reqFile, 'utf8').replace(/^﻿/, '')); } catch (e) { return { ok: false, errors: [`asset-requests.json bukan JSON valid: ${e.message}`] }; }
  const sv = validate('asset-requests', doc);
  if (!sv.ok) return { ok: false, errors: sv.errors.slice(0, 6).map((e) => `asset-requests.json ${e.path || '(root)'}: ${e.message}`) };
  const mm = matchRequests(used, doc);
  if (mm.length) return { ok: false, errors: mm };
  const holdFile = path.join(runDir, 'assets-hold.json');
  const manFile = path.join(runDir, 'assets-manifest.json');
  const sig = inboxSignature(ROOT, runKeyOf(job));
  const files = used.map((u) => u.file);
  let prev = readHold(holdFile);
  // Aset yang sudah lengkap di manifest (mis. owner menyelesaikan CAPTCHA lalu capture dijalankan manual) membatalkan hold basi.
  if (prev) { try { if (manifestVerdict(JSON.parse(readFileSync(manFile, 'utf8')), files).complete) { writeHold(holdFile, null); prev = null; } } catch { /* manifest belum ada */ } }
  if (prev && !shouldRetryCapture(prev, sig, Date.now())) return { ok: false, hold: true, missing: prev.missing, errors: [holdMessage(runKeyOf(job), prev.missing)] };
  markBusy('ambil-aset', 430_000);
  spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'capture-asset.mjs'), '--issue', runKeyOf(job)], { encoding: 'utf8', timeout: 420_000 });
  let manifest = null;
  try { manifest = JSON.parse(readFileSync(manFile, 'utf8')); } catch { /* dianggap belum ada */ }
  const verdict = manifestVerdict(manifest, files);
  if (verdict.complete) {
    try { writeHold(holdFile, null); } catch { /* kosmetik */ }
    // Pemeriksaan ketat (bukti logo asli, tipe aset sesuai saran visual, bukan placeholder): salah desain => kembali ke Designer, bukan ditahan.
    let carousel = null;
    try { carousel = JSON.parse(readFileSync(artifactPathFor(runKeyOf(job), 'copywriter'), 'utf8').replace(/^﻿/, '')); } catch { /* tanpa saran visual */ }
    const strict = checkAssets({ design, templates: TEMPLATES, manifest, identifier: runKeyOf(job), carousel, rootDir: ROOT });
    return strict.length ? { ok: false, errors: strict } : null;
  }
  writeHold(holdFile, { at: Date.now(), sig, missing: verdict.missing });
  return { ok: false, hold: true, missing: verdict.missing, errors: [holdMessage(runKeyOf(job), verdict.missing)] };
}

/** Deterministic gate for a finished stage: file exists, JSON parses, schema passes; designer also renders (visual QA). */
function checkOutput(job, stageName) {
  const p = outPathFor(runKeyOf(job), stageName);
  if (!existsSync(p)) return { ok: false, errors: [`file keluaran belum ada: ${p}`] };
  let data;
  try { data = JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { return { ok: false, errors: [`bukan JSON valid: ${e.message}`] }; }
  const spec = STAGE_OUTPUT[stageName];
  if (stageName === 'qa') return checkQaResult(data);
  if (stageName === 'researcher') {
    try {
      const norm = normalizeResearch(data);
      writeFileSync(artifactPathFor(runKeyOf(job), 'researcher'), JSON.stringify(norm, null, 2) + '\n', 'utf8');
    } catch (e) { return { ok: false, errors: [(e.errors ? e.errors.slice(0, 6).map((x) => `${x.path || '(root)'}: ${x.message}`) : [e.message]).join('; ')] }; }
    return { ok: true, errors: [] };
  }
  if (spec.schema) {
    const r = validate(spec.schema, data);
    if (!r.ok) return { ok: false, errors: r.errors.slice(0, 8).map((e) => `${e.path || '(root)'}: ${e.message}`) };
  }
  if (stageName === 'designer') {
    const held = assetGate(job, data, p);
    if (held) return held;
    const outDir = path.join(path.dirname(p), 'render');
    markBusy('render', 190_000);
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'render.mjs'), '--design', p, '--out', outDir], { encoding: 'utf8', timeout: 180_000 });
    let qa = null;
    try { qa = JSON.parse(readFileSync(path.join(outDir, 'visual-qa.json'), 'utf8')); } catch { /* handled below */ }
    if (r.status !== 0 || !qa?.passed) return { ok: false, errors: [`render gagal: ${String(r.stderr || r.stdout || 'tanpa keluaran').trim().split(/\r?\n/).slice(-6).join(' | ').slice(0, 600)}`] };
  }
  return { ok: true, errors: [] };
}

// Contoh berkas valid (fixture golden) per tahap, supaya agent meniru bentuknya alih-alih menebak.
const EXAMPLES = { researcher: '01-research-output.json', verifier: '02-verification-result.json', copywriter: '03-carousel.json', designer: '04-carousel-design.json' };
const exampleFor = (stage) => (EXAMPLES[stage] ? path.join(ROOT, 'fixtures', 'golden', 'valid', EXAMPLES[stage]) : null);

const NET_FILE = path.join(ROOT, 'workspace', 'network-state.json');
let netState = readNetworkState(NET_FILE) ?? {};
const fmtDur = (ms) => (ms < 90_000 ? Math.round(ms / 1000) + ' detik' : Math.round(ms / 60_000) + ' menit');
const hhmm = (ms) => new Date(ms).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

/** Satu pemeriksaan internet per tick. Galat pada pemeriksa sendiri dianggap "terjangkau" (jangan pernah menahan kerja karena bug). */
async function checkNetwork(job) {
  let reachable = true;
  try { reachable = (await probe()).reachable; } catch { reachable = true; }
  const { state, events } = decide(netState, reachable, Date.now());
  netState = state;
  try { writeNetworkState(NET_FILE, state); } catch { /* UI hanya kehilangan banner; pekerjaan tidak terganggu */ }
  for (const ev of events) {
    const live = job && ['planning', 'running'].includes(job.phase) ? job : null;
    if (ev.type === 'offline') {
      const msg = 'Internet terputus sejak ' + hhmm(ev.since) + '. Pekerjaan agent ditahan dan akan DILANJUTKAN OTOMATIS saat internet kembali.';
      log('OFFLINE: ' + msg);
      if (live && !DRY) await comment(live.masterIssueId, '⚠ ' + msg);
      notifyOwner('AI Agent Office: internet terputus', 'Pekerjaan ditahan, lanjut otomatis saat online.');
    } else if (ev.type === 'online') {
      const msg = 'Internet kembali setelah ' + fmtDur(ev.downMs) + '. Pekerjaan dilanjutkan dari tahap terakhir.';
      log('ONLINE: ' + msg);
      if (live && !DRY) await comment(live.masterIssueId, '✔ ' + msg);
      notifyOwner('AI Agent Office: internet kembali', 'Pekerjaan dilanjutkan otomatis.');
    }
  }
  return state;
}

const orderPathFor = (identifier) => path.join(ORDERS, `${identifier}.json`);

const CONTEXT_FILE = path.join(OUTPUTS, 'context', 'manager-context.md');
const SETTINGS_FILE = path.join(ROOT, 'workspace', 'orchestrator-settings.json');
const HOLDS_DIR = path.join(OUTPUTS, 'holds');
const OUTBOX_DIR = path.join(OUTPUTS, 'chat');

/** Komentar Manager terbaru di issue master (ringkasan yang ia tulis saat menyerahkan rencana). */
async function managerSummaryOf(masterIssueId) {
  try {
    const manager = agentByName('Manager');
    const cm = await j('/issues/' + masterIssueId + '/comments');
    const c = (Array.isArray(cm) ? cm : []).find((x) => x.authorAgentId === manager.id);
    return c ? String(c.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 600) : '';
  } catch { return ''; }
}

/** Rencana + analisis + pertanyaan Manager untuk owner MUNCUL DI CHAT (sekali per rencana). Tanpa membangkitkan Manager. */
async function postPlanToChat(p, needsApproval) {
  if (p.outboxPosted) return;
  try {
    const order = JSON.parse(readFileSync(orderPathFor(p.identifier), 'utf8').replace(/^\uFEFF/, ''));
    const manager = agentByName('Manager');
    const ag = manager ? await j('/agents/' + manager.id).catch(() => null) : null;
    appendOutbox(OUTBOX_DIR, buildPlanMessage({ identifier: p.identifier, order, managerSummary: await managerSummaryOf(p.masterIssueId), needsApproval, from: speakerName(ag?.adapterType) }));
    p.outboxPosted = true;
    log(p.identifier + ' rencana Manager ditampilkan di chat owner');
  } catch (e) { log(p.identifier + ' gagal menampilkan rencana di chat: ' + String(e?.message ?? e).slice(0, 120)); }
}

/** Jawaban/catatan owner dari chat dimasukkan ke instruksi tiap tahap konten utama (tanpa membangkitkan Manager). */
async function applyOwnerNote(p, text) {
  try {
    const op = orderPathFor(p.identifier);
    const order = JSON.parse(readFileSync(op, 'utf8').replace(/^\uFEFF/, ''));
    const clean = String(text).replace(/\s+/g, ' ').trim().slice(0, 500);
    const line = 'Catatan owner (jawaban untuk rencana ini, ikuti): ' + clean;
    order.ownerNotes = [...(order.ownerNotes ?? []), clean];
    for (const k of Object.keys(order.stages ?? {})) order.stages[k] = String(order.stages[k]).slice(0, LIMITS.maxText - 600) + String.fromCharCode(10) + line;
    writeFileSync(op, JSON.stringify(order, null, 2) + '\n', 'utf8');
    await comment(p.masterIssueId, 'Catatan owner dicatat ke rencana: ' + clean).catch(() => {});
    log(p.identifier + ' catatan owner dari chat dimasukkan ke rencana');
  } catch (e) { log(p.identifier + ' gagal menerapkan catatan owner: ' + String(e?.message ?? e).slice(0, 120)); }
}

/** Owner membatalkan rencana yang ditahan: issue master dibatalkan, rencana keluar dari antrean, tidak ada kuota agent yang terpakai. */
async function cancelPlan(state, p) {
  await j('/issues/' + p.masterIssueId, jb('PATCH', { status: 'cancelled', assigneeAgentId: null })).catch(() => {});
  state.pending = (state.pending ?? []).filter((x) => x !== p);
  state.history.push({ ...p, phase: 'blocked', endedMs: Date.now(), note: 'rencana dibatalkan owner' });
  log(p.identifier + ' rencana dibatalkan owner (dari chat)');
}
let extraBuffer = [];

/** Paket konteks untuk Manager (antrean, konten terbaru, pemakaian agent, keluhan owner), dibuat KODE sebelum perencanaan. */
async function writeManagerContext() {
  try {
    const st = readState();
    const now = Date.now();
    const limits = (() => { try { return JSON.parse(readFileSync(path.join(ROOT, 'divisions', 'edukasiai', 'limits.json'), 'utf8').replace(/^\uFEFF/, '')); } catch { return {}; } })();
    const capOf = (name) => limits.perAgent?.[name]?.maxRunsPerAgentPerDay ?? limits.maxRunsPerAgentPerDay ?? 30;
    const ags = await j(`/companies/${company.id}/agents`);
    const runs = await j(`/companies/${company.id}/heartbeat-runs?limit=300`);
    const since = startOfDayWib(now);
    const agentsInfo = ags.map((a) => ({ name: a.name, model: a.adapterConfig?.model ?? a.adapterType, status: a.status, runsToday: runs.filter((r) => r.agentId === a.id && r.status !== 'cancelled' && Date.parse(r.startedAt ?? r.createdAt ?? 0) >= since).length, cap: capOf(a.name) }));
    const runsDir = path.join(OUTPUTS, 'runs');
    const recent = existsSync(runsDir) ? readdirSync(runsDir, { withFileTypes: true }).filter((e) => e.isDirectory() && CONTENT_RE.test(e.name)).map((e) => {
      const key = latestRunKey(OUTPUTS, e.name); const dir = runDirOf(OUTPUTS, key);
      let t = 0; try { t = statSync(dir).mtimeMs; } catch { /* tanpa waktu */ }
      let title = e.name; try { title = JSON.parse(readFileSync(path.join(dir, 'carousel.json'), 'utf8').replace(/^\uFEFF/, '')).topic ?? title; } catch { /* belum ada carousel */ }
      return { code: e.name, label: labelOf(key), title, t };
    }).sort((x, y) => y.t - x.t).slice(0, 10) : [];
    const rd = routingDirFor(ROOT);
    const notes = existsSync(rd) ? readdirSync(rd).filter((n) => n.endsWith('.request.json')).map((n) => readJsonLoose(path.join(rd, n))).filter(Boolean).sort((x, y) => (y.requestedAt ?? 0) - (x.requestedAt ?? 0)).map((r) => r.reason).filter(Boolean) : [];
    const active = st.job && !['done', 'blocked'].includes(st.job.phase) ? { identifier: st.job.identifier, phase: st.job.phase, stageName: st.job.stageIndex >= 0 ? STAGE_AGENT[STAGES[st.job.stageIndex]] : undefined } : null;
    const inbox = existsSync(INBOX) ? readdirSync(INBOX).filter((n) => BRIEF_EXT.has(path.extname(n).toLowerCase())).length : 0;
    mkdirSync(path.dirname(CONTEXT_FILE), { recursive: true });
    writeFileSync(CONTEXT_FILE, renderManagerContext({ nowMs: now, active, followers: (st.followers ?? []).map((x) => ({ identifier: x.identifier, phase: x.phase, stageName: x.stageIndex >= 0 ? STAGE_AGENT[STAGES[x.stageIndex]] : undefined })), pending: (st.pending ?? []).map((p) => ({ identifier: p.identifier, ready: p.ready, hold: p.hold })), inbox, recent, agents: agentsInfo, ownerNotes: notes }) + '\n', 'utf8');
  } catch (e) { log('konteks Manager gagal dibuat: ' + String(e?.message ?? e).slice(0, 120)); }
}

/** Konten tambahan dari satu brief: tiap topik terpisah jadi konten sendiri (kode konten berbeda) dengan rencana Manager yang sudah ada. */
async function spawnExtras(job, order) {
  for (const ex of extraContentsOf(order)) {
    const stamp = new Date().toISOString().slice(5, 16).replace('T', ' ');
    const issue = await j(`/companies/${company.id}/issues`, jb('POST', { title: `Produksi: ${ex.title.slice(0, 60)} (${stamp})`, description: `Konten tambahan dari brief ${job.identifier}. Rencana Manager sudah ada; menunggu giliran.`, status: 'backlog', projectId: project.id }));
    mkdirSync(ORDERS, { recursive: true });
    writeFileSync(orderPathFor(issue.identifier), JSON.stringify({ title: ex.title, analysis: order.analysis, stages: ex.stages, fromBrief: job.identifier }, null, 2) + '\n', 'utf8');
    extraBuffer.push({ ...newJob({ masterIssueId: issue.id, identifier: issue.identifier, nowMs: Date.now() }), brief: job.brief, ready: true, readyMs: Date.now(), planAnnounced: true, extrasSpawned: true });
    log(`${issue.identifier} konten tambahan dari ${job.identifier}: "${ex.title}" mengantre dengan rencana Manager`);
  }
}

/** Rencana valid: umumkan ke owner (apa yang dipahami Manager) dan buat konten tambahan, sekali saja per brief. */
async function onPlanAccepted(job, runningJob = null, review = false) {
  if (job.planAnnounced) return;
  job.planAnnounced = true;
  let order = null;
  try { order = JSON.parse(readFileSync(orderPathFor(job.identifier), 'utf8').replace(/^\uFEFF/, '')); } catch { return; }
  const tail = review ? ' Menunggu persetujuan Anda sebelum agent lain bekerja (jalankan: node scripts/plan-release.mjs ' + job.identifier + ').' : runningJob ? ` Menunggu giliran: ${runningJob.identifier} sedang berjalan.` : '';
  await comment(job.masterIssueId, renderAnalysisComment(order) + tail).catch(() => {});
  await postPlanToChat(job, review);
  if (!review && !job.extrasSpawned) { job.extrasSpawned = true; await spawnExtras(job, order); }
}

let templatesCache = null;
/** Template perintah per divisi untuk Manager (berkas SOP); dibaca sekali, dipotong agar prompt tetap ringkas. */
function workOrderTemplates() {
  if (templatesCache === null) {
    try { templatesCache = readFileSync(path.join(ROOT, 'divisions', 'edukasiai', 'sop', 'work-order-templates.md'), 'utf8').replace(/^\uFEFF/, '').slice(0, 5000); } catch { templatesCache = ''; }
  }
  return templatesCache ? 'TEMPLATE PERINTAH (ikuti bentuknya; sesuaikan isinya dengan brief dan kemampuan tiap agent):\n' + templatesCache : '';
}

function managerInstruction({ identifier, brief }) {
  return buildManagerInstruction({ identifier, brief, contextFile: CONTEXT_FILE, orderPath: orderPathFor(identifier), designBriefPath: path.join(OUTPUTS, 'briefs', `${identifier}.md`), templates: workOrderTemplates() });
}

/**
 * Mode revisi (hemat kuota): tahap sebelum `mulai` memakai artefak run sumber (disalin KODE, tanpa agent); pekerjaan baru hanya di tahap mulai dan sesudahnya.
 * Kode konten TIDAK berubah: revisi disimpan di runs/<kode-konten>/revision-N (keputusan owner); issue master Paperclip (nomor baru) hanya internal.
 * Work order dibuat kode (tanpa Manager) dari catatan owner; issue master hanya wadah komentar.
 */
async function ingestRevision(f, full, brief, rev, title) {
  const fromKey = rev.from; // EDU-49 atau EDU-49/revision-N
  const contentId = contentOf(fromKey);
  const srcDir = runDirOf(OUTPUTS, fromKey);
  const ARTIFACTS = { researcher: ['research-raw.json', 'research-output.json'], verifier: ['verification-result.json'], copywriter: ['carousel.json'] };
  const needed = STAGES.slice(0, rev.startIndex).flatMap((s) => ARTIFACTS[s] ?? []);
  const missing = needed.filter((n) => !existsSync(path.join(srcDir, n)) && n !== 'research-raw.json');
  if (missing.length) {
    mkdirSync(PROCESSED, { recursive: true }); renameSync(full, path.join(PROCESSED, `ditolak-revisi-${f}`));
    log(`brief revisi ${f} ditolak: ${fromKey} tidak punya ${missing.join(', ')}`);
    return null;
  }
  if (DRY) { log(`[dry-run] revisi ${f} dari ${fromKey} mulai ${rev.start}`); return null; }
  const runKey = nextRunKey(OUTPUTS, contentId);
  const issue = await j(`/companies/${company.id}/issues`, jb('POST', { title: `Revisi ${labelOf(runKey)}: ${title} (${new Date().toISOString().slice(5, 16).replace('T', ' ')})`, description: `Revisi ${labelOf(runKey)} dari ${labelOf(fromKey)}, mulai tahap ${rev.start}. Catatan owner:\n${rev.notes.slice(0, 1500)}`, status: 'backlog', projectId: project.id }));
  const runDir = runDirOf(OUTPUTS, runKey);
  mkdirSync(runDir, { recursive: true });
  writeRunMeta(OUTPUTS, runKey, { masterIdentifier: issue.identifier, masterIssueId: issue.id, from: fromKey, startStage: rev.start, createdAt: new Date().toISOString() });
  for (const n of needed) if (existsSync(path.join(srcDir, n))) copyFileSync(path.join(srcDir, n), path.join(runDir, n));
  if (rev.start === 'designer') {
    // aset dan manifest (bukti capture) dibawa; capture hanya mengambil yang belum ada/ditolak, dan 'kept' hanya sah bila manifest mencatat captured/owner-supplied
    const srcAssets = path.join(srcDir, 'assets');
    if (existsSync(srcAssets)) {
      mkdirSync(path.join(runDir, 'assets'), { recursive: true });
      for (const a of readdirSync(srcAssets)) copyFileSync(path.join(srcAssets, a), path.join(runDir, 'assets', a));
    }
    for (const n of ['assets-manifest.json', 'asset-requests.json']) if (existsSync(path.join(srcDir, n))) copyFileSync(path.join(srcDir, n), path.join(runDir, n));
  }
  const note = `REVISI ${labelOf(runKey)} dari ${labelOf(fromKey)} (hasil tahap sebelumnya dipakai apa adanya; jangan mengulang riset/verifikasi). Gambar memakai path runs/${runKey}/assets/<berkas>. Catatan owner (data rujukan):\n${rev.notes.slice(0, 3000)}`;
  const order = { title: `Revisi ${title}`.slice(0, 120), stages: Object.fromEntries(STAGES.map((s, i) => [s, i < rev.startIndex ? `Dilewati (revisi): memakai hasil ${labelOf(fromKey)}.` : note])) };
  mkdirSync(ORDERS, { recursive: true });
  writeFileSync(orderPathFor(issue.identifier), JSON.stringify(order, null, 2) + '\n', 'utf8');
  mkdirSync(PROCESSED, { recursive: true });
  renameSync(full, path.join(PROCESSED, `${Date.now()}-${f}`));
  const jobPatch = { phase: 'running', stageIndex: rev.startIndex, stageStartedMs: Date.now(), stageAttempts: 1, lastTickMs: Date.now(), runKey, contentId, revision: revisionOf(runKey) };
  jobPatch.stageIssueId = await createStage({ identifier: issue.identifier, runKey, brief }, STAGES[rev.startIndex]);
  await comment(issue.id, `Revisi ${labelOf(runKey)} dimulai di tahap ${STAGE_AGENT[STAGES[rev.startIndex]]} (tahap sebelumnya memakai hasil lama, tanpa kuota agent).`);
  log(`brief revisi ${f} -> ${labelOf(runKey)} (issue master ${issue.identifier}), mulai ${rev.start}`);
  return { id: issue.id, identifier: issue.identifier, brief, jobPatch };
}

const ROUTING = routingDirFor(ROOT);
const readJsonLoose = (file) => { try { return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return undefined; } };

/**
 * Setelah owner menolak (ADR-0004): baca permintaan routing, tunggu jendela batal, pakai keputusan Manager (divalidasi KODE) atau cadangan kata kunci,
 * lalu jatuhkan brief revisi ke inbox. Hanya berkas yang ditolak yang disentuh; issue lama ditutup digantikan revisi.
 */
async function processRoutings() {
  if (DRY || !existsSync(ROUTING)) return;
  for (const n of readdirSync(ROUTING).filter((x) => x.endsWith('.request.json'))) {
    const identifier = n.replace('.request.json', '');
    if (!/^EDU-[0-9]+$/.test(identifier) || existsSync(doneFile(ROUTING, identifier))) continue;
    const request = readJsonLoose(path.join(ROUTING, n));
    if (!request?.issueId) continue;
    const mf = managerFile(ROUTING, identifier);
    const managerDoc = existsSync(mf) ? (readJsonLoose(mf) ?? 'bukan JSON valid') : null;
    const r = resolveRouting({ request, manager: managerDoc, cancelled: existsSync(cancelFile(ROUTING, identifier)), nowMs: Date.now() });
    if (r.action === 'wait') continue;
    writeFileSync(doneFile(ROUTING, identifier), JSON.stringify({ at: Date.now(), action: r.action, start: r.start ?? null, source: r.source ?? null }) + '\n');
    if (r.action === 'cancel') {
      await comment(request.issueId, 'Owner membatalkan revisi otomatis. Keputusan tolak tetap tercatat; paket menunggu keputusan baru.');
      await j('/issues/' + request.issueId, jb('PATCH', { status: 'in_review', assigneeAgentId: null })).catch(() => {});
      log(identifier + ' revisi dibatalkan owner');
      continue;
    }
    const srcKey = runKeyForMaster(OUTPUTS, identifier) ?? identifier;
    const srcDir = runDirOf(OUTPUTS, srcKey);
    const need = ['research-output.json', 'verification-result.json', 'carousel.json'].filter((x) => !existsSync(path.join(srcDir, x)));
    if (need.length) {
      await comment(request.issueId, 'Revisi tidak bisa dijadwalkan: artefak ' + labelOf(srcKey) + ' hilang (' + need.join(', ') + '). Beri perintah riset/brief baru.');
      log(identifier + ' revisi gagal dijadwalkan: artefak hilang ' + need.join(','));
      continue;
    }
    const brief = buildRevisionBrief({ from: srcKey, start: r.start, reason: request.reason, summary: r.summary, instructions: r.instructions, source: r.source });
    mkdirSync(INBOX, { recursive: true });
    writeFileSync(path.join(INBOX, 'revisi-' + identifier + '-' + Date.now() + '.md'), brief, 'utf8');
    await comment(request.issueId, 'Revisi dijadwalkan: mulai dari tahap ' + r.start + ' (penentu: ' + r.source + '). ' + r.summary + (r.escalate ? ' CATATAN: masalah fakta/sumber mungkin butuh riset ulang; Owner perlu memberi perintah riset baru bila revisi ini belum cukup.' : '') + ' Paket baru akan masuk antrian approval; issue ini ditutup digantikan revisi.');
    await j('/issues/' + request.issueId, jb('PATCH', { status: 'cancelled', assigneeAgentId: null })).catch(() => {});
    log(identifier + ' ditolak owner -> revisi mulai ' + r.start + ' (penentu ' + r.source + ')');
  }
}

async function ingest(onlyNormal = false, onlyRevision = false) {
  if (!existsSync(INBOX)) mkdirSync(INBOX, { recursive: true });
  const candidates = readdirSync(INBOX).filter((n) => BRIEF_EXT.has(path.extname(n).toLowerCase()) && statSync(path.join(INBOX, n)).isFile()).sort();
  // onlyNormal: perencanaan di muka hanya untuk brief biasa; brief revisi tidak butuh Manager dan menunggu slot job
  const isRev = (n) => { try { return !!parseRevisionBrief(readFileSync(path.join(INBOX, n), 'utf8')); } catch { return false; } };
  const f = onlyNormal ? candidates.find((n) => !isRev(n)) : onlyRevision ? candidates.find(isRev) : candidates[0];
  if (!f) return null;
  const full = path.join(INBOX, f);
  if (statSync(full).size > MAX_BRIEF) { mkdirSync(PROCESSED, { recursive: true }); renameSync(full, path.join(PROCESSED, `ditolak-besar-${f}`)); log(`brief ${f} terlalu besar, dilewati`); return null; }
  const brief = readFileSync(full, 'utf8');
  const title = (brief.match(/^#\s+(.+)$/m)?.[1] ?? brief.split(/\r?\n/).find((l) => l.trim()) ?? f).trim().slice(0, 60);
  const rev = parseRevisionBrief(brief);
  if (rev) return ingestRevision(f, full, brief, rev, title);
  const manager = agentByName('Manager');
  if (!manager) throw new Error('agent Manager tidak ada');
  if (!DRY) await writeManagerContext();
  if (DRY) { log(`[dry-run] akan membuat issue master dari ${f}: "${title}"`); return null; }
  const issue = await j(`/companies/${company.id}/issues`, jb('POST', { title: `Produksi: ${title} (${new Date().toISOString().slice(5, 16).replace('T', ' ')})`, description: 'Menyiapkan work order…', status: 'todo', projectId: project.id }));
  await j(`/issues/${issue.id}`, jb('PATCH', { description: forwardSlashPaths(managerInstruction({ identifier: issue.identifier, brief })), assigneeAgentId: manager.id, status: 'todo' }));
  mkdirSync(PROCESSED, { recursive: true });
  renameSync(full, path.join(PROCESSED, `${Date.now()}-${f}`));
  log(`brief ${f} -> issue master ${issue.identifier} (Manager menyusun work order)`);
  return { id: issue.id, identifier: issue.identifier, brief };
}

// Setelah perencanaan, issue master "diparkir" tanpa penanggung jawab: komentar orkestrator tidak membangunkan Manager
// (menghemat kuota) dan Manager tidak tampak "butuh manusia" di Office View karena issue lama berstatus blocked.
const parkMaster = (job) => j('/issues/' + job.masterIssueId, jb('PATCH', { assigneeAgentId: null, status: 'backlog' }));

// Rapikan issue tahap milik orkestrator yang sudah tidak relevan (blocked/in_progress/todo) supaya agen tidak tampak "butuh manusia" di UI.
// production = id produksi (mis. EDU-27) atau null = semua produksi KECUALI job aktif. Issue in_review/done/cancelled tidak disentuh.
async function tidyStageIssues(production, activeJob) {
  const issues = await j(`/companies/${company.id}/issues`);
  let n = 0;
  for (const i of issues) {
    const m = String(i.title).match(/^(EDU-[0-9]+) · [A-Za-z]+/);
    if (!m || ['in_review', 'done', 'cancelled'].includes(i.status)) continue;
    if (production ? m[1] !== production : (activeJob && m[1] === activeJob.identifier && activeJob.phase === 'running' && i.id === activeJob.stageIssueId)) continue;
    await j('/issues/' + i.id, jb('PATCH', { status: 'cancelled', assigneeAgentId: null })).catch(() => {});
    n += 1;
  }
  if (n) log('rapi-rapi: ' + n + ' issue tahap basi dibatalkan' + (production ? ' (produksi ' + production + ')' : ''));
}

// Paperclip bisa membalik issue tahap menjadi "blocked" setelah run yang menggantung dihentikan, sehingga agen tampak "butuh manusia" di UI.
// Dipanggil berkala: issue tahap blocked milik produksi yang SUDAH SELESAI dikembalikan ke in_review (menunggu approval, tetap tampil di tab Approval);
// milik produksi lain yang tidak aktif dibatalkan. Issue tahap job yang sedang berjalan tidak disentuh.
let lastTidyMs = 0;
async function tidyBlocked(state) {
  if (Date.now() - lastTidyMs < 60_000) return;
  lastTidyMs = Date.now();
  const liveStageIds = new Set([state.job, ...(state.followers ?? [])].filter((x) => x?.phase === 'running' && x.stageIssueId).map((x) => x.stageIssueId));
  const doneProds = new Set([...(state.history ?? []), ...(state.job ? [state.job] : [])].filter((x) => x.phase === 'done').map((x) => x.identifier));
  const issues = await j(`/companies/${company.id}/issues`);
  let restored = 0; let cancelled = 0;
  for (const i of issues) {
    const m = String(i.title).match(/^(EDU-[0-9]+) · [A-Za-z]+/);
    if (!m || i.status !== 'blocked' || liveStageIds.has(i.id)) continue;
    // Blokir yang SENGAJA dari agen (mis. disposisi QA "fail") tidak boleh dibalik: hanya blokir akibat pemulihan otomatis Paperclip yang dipulihkan.
    const cm = await j('/issues/' + i.id + '/comments').catch(() => []);
    const lastC = Array.isArray(cm) ? cm[0] : null;
    if (lastC && lastC.authorAgentId) continue;
    if (doneProds.has(m[1])) { await j('/issues/' + i.id, jb('PATCH', { status: 'in_review' })).catch(() => {}); restored += 1; }
    else { await j('/issues/' + i.id, jb('PATCH', { status: 'cancelled', assigneeAgentId: null })).catch(() => {}); cancelled += 1; }
  }
  if (restored || cancelled) log('rapi-rapi berkala: ' + restored + ' issue tahap dikembalikan ke in_review, ' + cancelled + ' dibatalkan');
}

const comment = (issueId, text) => j(`/issues/${issueId}/comments`, jb('POST', { body: `[Orkestrator] ${text}` }));

async function gatherFacts(job, state) {
  const now = Date.now();
  const manager = agentByName('Manager');
  const runs = await j(`/companies/${company.id}/heartbeat-runs?limit=60`);
  const mgrRuns = runs.filter((r) => r.agentId === manager.id && (r.contextSnapshot?.issueId ? r.contextSnapshot.issueId === job.masterIssueId : Date.parse(r.startedAt ?? r.createdAt ?? 0) >= job.createdMs - 5000));
  // "Selesai" = ada run Manager yang BERHASIL dan belum pernah ditangani; run dibatalkan/gagal bukan selesai.
  const succeeded = mgrRuns.filter((r) => r.status === 'succeeded').length;
  const live = mgrRuns.some((r) => ['queued', 'running'].includes(r.status));
  const managerFinished = !live && succeeded > (job.handledRuns ?? 0);
  const managerFailed = !live && !managerFinished && mgrRuns.find((r) => ['failed', 'error', 'timed_out'].includes(r.status));
  let order = null;
  const op = orderPathFor(job.identifier);
  if (existsSync(op)) { try { let raw = JSON.parse(readFileSync(op, 'utf8')); if (job.phase === 'planning') { const norm = normalizeOrderFileNames(raw); if (norm.changed) { raw = norm.order; writeFileSync(op, JSON.stringify(raw, null, 2) + '\n', 'utf8'); log(job.identifier + ' nama berkas di work order diperbaiki ke nama baku: ' + norm.replaced.map((r) => r.from + ' -> ' + r.to).join(', ')); } } order = validateOrder(raw); if (order.ok && job.phase === 'planning') { const sc = checkOrderStructure(raw); if (!sc.ok) order = sc; } } catch (e) { order = { ok: false, errors: [`JSON tidak bisa dibaca: ${e.message}`] }; } }
  let stage = null; let output;
  if (job.phase === 'running' && job.stageIssueId) {
    const issue = await j(`/issues/${job.stageIssueId}`);
    const agentId = issue.assigneeAgentId;
    // Penilaian kegagalan: abaikan run dibatalkan dan "scheduled_retry" (percobaan ulang bawaan Paperclip yang bisa macet bila agent
    // berstatus error). Gagal = tidak ada run yang masih berjalan/antre, dan run nyata terakhir berakhir gagal.
    const mine = runs.filter((r) => r.agentId === agentId && Date.parse(r.startedAt ?? r.createdAt ?? 0) >= job.stageStartedMs - 5000);
    const active = mine.some((r) => ['running', 'queued'].includes(r.status));
    const last = mine.find((r) => !['cancelled', 'scheduled_retry'].includes(r.status));
    const failed = !active && !!last && ['failed', 'error', 'timed_out'].includes(last.status) && !['in_review', 'done'].includes(issue.status);
    let status = issue.status;
    let failedNow = failed;
    // Selesai berbasis berkas: agent yang sudah menulis keluaran valid dan SEGAR (lebih baru dari awal tahap) tetapi lupa memanggil
    // complete_stage tidak boleh dianggap macet. Berkas basi dari percobaan sebelumnya tidak dihitung (cek waktu ubah).
    if (!['in_review', 'done'].includes(status)) {
      try {
        const st = statSync(outPathFor(runKeyOf(job), STAGES[job.stageIndex]));
        // Berkas segar (ditulis selama tahap ini) dan STABIL (tidak berubah >= 60 dtk, jadi bukan setengah tertulis).
        if (st.mtimeMs >= job.stageStartedMs - 5000 && Date.now() - st.mtimeMs >= 60_000) {
          const chk = checkOutput(job, STAGES[job.stageIndex]);
          if (chk.ok) {
            status = 'done'; output = chk; failedNow = false;
            // Agen yang sudah menulis keluaran valid tetapi tidak pernah menyudahi run-nya: hentikan run itu (hemat kuota) dan tutup issue tahap.
            for (const r of mine.filter((x) => ['running', 'queued'].includes(x.status))) {
              await j('/heartbeat-runs/' + r.id + '/cancel', jb('POST', {})).catch(() => {});
              log(job.identifier + ' ' + STAGE_AGENT[STAGES[job.stageIndex]] + ' menulis keluaran valid tetapi run masih berjalan: run dihentikan');
            }
            await j('/issues/' + job.stageIssueId, jb('PATCH', { status: 'in_review' })).catch(() => {});
          }
        }
      } catch { /* berkas belum ada */ }
    }
    stage = { status, failed: failedNow, error: failedNow ? last.error : undefined };
    if (!output && ['in_review', 'done'].includes(status)) output = checkOutput(job, STAGES[job.stageIndex]);
    // Salinan keluaran yang SUDAH diterima gerbang (sidecar .accepted): agen yang masih hidup tidak bisa menimpa keputusan yang sudah diambil.
    if (output?.ok) { try { const p = outPathFor(runKeyOf(job), STAGES[job.stageIndex]); if (!existsSync(p + '.accepted')) writeFileSync(p + '.accepted', readFileSync(p)); } catch { /* kosmetik */ } }
  }
  if (job.phase === 'planning' && managerFailed && !order?.ok) return { order, managerFinished: false, managerFailedError: managerFailed.error ?? managerFailed.status, succeeded, stage, nowMs: now };
  return { order, managerFinished, succeeded, stage, output, nowMs: now };
}

async function createStage(job, stage) {
  const order = JSON.parse(readFileSync(orderPathFor(job.identifier), 'utf8'));
  const ag = agentByName(STAGE_AGENT[stage]);
  const issue = await j(`/companies/${company.id}/issues`, jb('POST', {
    title: `${job.identifier} · ${STAGE_AGENT[stage]} (${new Date().toISOString().slice(11, 19)}): ${order.title}`,
    description: stageDescription({
      order, stage, identifier: labelOf(runKeyOf(job)), outputsDir: OUTPUTS, brief: job.brief, refs: standingRefs(stage),
      inputs: STAGES.slice(0, STAGES.indexOf(stage)).map((s) => artifactPathFor(runKeyOf(job), s)),
      output: { path: outPathFor(runKeyOf(job), stage), schema: STAGE_OUTPUT[stage].schema, example: exampleFor(stage), note: stage === 'researcher' ? 'Isi: {"candidates":[{"title","summary","url","published_at","source_name"}]} saja, 5-10 kandidat; kode yang menambah id dan metadata.' : stage === 'qa' ? 'Isi: {"passed": true|false, "llmReview": {"textOk": true|false, "designOk": true|false}, "notes": ["..."]}; passed=true hanya bila render, teks, dan sumber sesuai brief tetap. JANGAN memanggil qa_submit_result atau handoff_to_owner: orkestrator memanggilnya (di issue produksi) memakai penilaianmu di llmReview.' : stage === 'designer' ? `Jika desain memakai gambar (slot image), tulis juga ${path.join(OUTPUTS, 'runs', runKeyOf(job), 'asset-requests.json')} (skema asset-requests; file sama persis dengan nama di slot image runs/${runKeyOf(job)}/assets/<file>); gambar diambil KODE setelah kamu selesai, jangan membuat gambar sendiri. Setelah menulis, jalankan render_carousel hanya bila semua gambar sudah ada; bila render gagal karena gambar belum ada, itu normal: serahkan saja, orkestrator mengambil aset lalu merender.` : '' },
    }),
    status: 'todo', projectId: project.id, assigneeAgentId: ag.id,
  }));
  log(`tahap ${STAGE_AGENT[stage]} -> issue ${issue.identifier}`);
  return issue.id;
}

async function applyActions(job, actions, facts) {
  for (const act of actions) {
    if (DRY) { log(`[dry-run] ${JSON.stringify(act)}`); continue; }
    if (act.type === 'comment') await comment(job.masterIssueId, act.text);
    else if (act.type === 'createStage') { job.stageIssueId = await createStage(job, act.stage); if (act.stage === STAGES[0]) { await onPlanAccepted(job); await parkMaster(job); } }
    else if (act.type === 'rewakeManager') { job.handledRuns = facts.succeeded; await comment(job.masterIssueId, `Work order belum valid: ${act.errors.join('; ')}. Perbaiki file ${orderPathFor(job.identifier)}, baca ulang, lalu complete_stage lagi.`); }
    else if (act.type === 'retryStage') {
      // Galat sementara penyedia model: pulihkan agent bila status error, tunggu sebentar, lalu buat issue tahap baru.
      const ag = agentByName(STAGE_AGENT[act.stage]);
      const cur = await j('/agents/' + ag.id);
      if (['error', 'paused'].includes(cur.status)) await j('/agents/' + ag.id + '/resume', jb('POST', {}));
      // Tutup issue tahap lama (milik orkestrator) agar percobaan ulang bawaan Paperclip tidak berjalan bersamaan dengan yang baru.
      if (act.oldIssueId) await j('/issues/' + act.oldIssueId, jb('PATCH', { status: 'cancelled', assigneeAgentId: null })).catch(() => {});
      await new Promise((r) => setTimeout(r, 45_000));
      job.stageIssueId = await createStage(job, act.stage);
      job.stageStartedMs = Date.now();
      log(job.identifier + ' tahap ' + STAGE_AGENT[act.stage] + (act.network ? ' diulang karena jaringan (ke-' + job.netRetries + ')' : ' diulang otomatis (percobaan ' + job.stageAttempts + ')') + ': ' + act.reason);
    }
    else if (act.type === 'rejectStage') {
      await j('/issues/' + job.stageIssueId + '/comments', jb('POST', { body: forwardSlashPaths('[Orkestrator] Keluaran belum lolos pemeriksaan: ' + act.errors.join('; ') + '. Perbaiki file keluaran, baca ulang, lalu panggil complete_stage lagi.') }));
      await j('/issues/' + job.stageIssueId, jb('PATCH', { status: 'in_progress' }));
      job.stageStartedMs = Date.now();
      log(job.identifier + ' tahap ' + STAGE_AGENT[STAGES[job.stageIndex]] + ' ditolak gerbang: ' + act.errors.join('; ').slice(0, 160));
    }
    else if (act.type === 'finish') {
      // Manager bertanggung jawab sebagai pengelola: paket diserahkan ke Manager (satu run) untuk laporan akhir, lalu menunggu keputusan Owner.
      // Finalisasi deterministik: dokumen + catatan verify_candidate + segel render + qa_submit_result + handoff_to_owner pada SATU issue produksi (kode, bukan LLM).
      markBusy('finalisasi', 490_000);
      const fin = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'finalize-production.mjs'), job.identifier, '--run', runKeyOf(job)], { encoding: 'utf8', timeout: 480_000 });
      const lastLine = String(fin.stdout || '').trim().split(String.fromCharCode(10)).map((x) => x.trim()).filter(Boolean).pop() ?? '';
      if (fin.status !== 0) {
        log(`${job.identifier} finalisasi GAGAL: ${lastLine.slice(0, 300)}`);
        await comment(job.masterIssueId, `DIBLOKIR pada finalisasi: ${lastLine.slice(0, 400)}`);
        await parkMaster(job);
        job.phase = 'blocked';
        continue;
      }
      await comment(job.masterIssueId, act.text + ` LAPORAN AKHIR untuk Manager: baca ${path.join(OUTPUTS, 'runs', runKeyOf(job), 'qa-result.json')} dan ${artifactPathFor(runKeyOf(job), 'copywriter')}, lalu tulis SATU komentar ringkas untuk Owner (judul, jumlah slide, sumber, vonis QA, catatan penting, lokasi contact-sheet ${path.join(OUTPUTS, 'runs', job.identifier, 'render', 'contact-sheet.png')}) dengan perintah say, lalu berhenti.`);
      log(`${job.identifier} selesai; diserahkan ke Manager untuk laporan akhir, menunggu owner`);
      await tidyStageIssues(job.identifier, null).catch(() => {});
    }
    else if (act.type === 'holdAssets') {
      await comment(job.masterIssueId, act.text);
      notifyOwner('AI Agent Office: butuh gambar asli', 'Produksi ' + job.identifier + ' ditahan; lihat komentar atau TV.');
      log(job.identifier + ' DITAHAN menunggu aset gambar asli');
    }
    else if (act.type === 'block') { await comment(job.masterIssueId, `DIBLOKIR: ${act.reason}. Butuh keputusan owner.`); await parkMaster(job); log(`${job.identifier} DIBLOKIR: ${act.reason}`); }
  }
}

/**
 * Perencanaan di muka (ADR-0004; keputusan owner: Manager harus responsif): selagi sebuah job berjalan, Manager sudah menyusun work order brief berikutnya.
 * Tahap agent tetap SATU job pada satu waktu; yang paralel hanya Manager (tidak dipakai agent tahap). Rencana siap menunggu giliran, lalu dipromosikan.
 */
async function planAhead(state, offline, review = false) {
  state.pending ??= [];
  if (DRY) return;
  // Pelepasan rencana yang ditahan (mode tinjau): berkas holds/<ID>.release dibuat owner (plan-release.mjs / tombol).
  for (const p of [...state.pending]) {
    if (p.ready && !p.outboxPosted) await postPlanToChat(p, !!p.hold);
    if (p.hold && existsSync(HOLDS_DIR)) {
      // urutan: catatan owner, lalu pembatalan, lalu persetujuan
      for (const n of readdirSync(HOLDS_DIR).filter((x) => x.startsWith(p.identifier + '.') && x.endsWith('.note')).sort()) {
        const nf = path.join(HOLDS_DIR, n);
        const text = readJsonLoose(nf)?.text;
        try { unlinkSync(nf); } catch { /* sudah hilang */ }
        if (text) await applyOwnerNote(p, String(text));
      }
      const cf = path.join(HOLDS_DIR, p.identifier + '.cancel');
      if (existsSync(cf)) { try { unlinkSync(cf); } catch { /* sudah hilang */ } await cancelPlan(state, p); continue; }
    }
    const rel = path.join(HOLDS_DIR, p.identifier + '.release');
    if (p.hold && existsSync(rel)) {
      try { unlinkSync(rel); } catch { /* sudah hilang */ }
      p.hold = false; delete p.holdNote;
      log(p.identifier + ' rencana disetujui owner; dilepas');
      await comment(p.masterIssueId, 'Rencana disetujui owner. Menunggu giliran tahapnya.').catch(() => {});
      if (!p.extrasSpawned) { p.extrasSpawned = true; try { await spawnExtras(p, JSON.parse(readFileSync(orderPathFor(p.identifier), 'utf8').replace(/^\uFEFF/, ''))); } catch { /* tanpa konten tambahan */ } }
    }
  }
  const slotFree = state.pending.filter((p) => !p.hold && !p.ready).length < MAX_PENDING_PLANS;
  if (review ? slotFree : canPlanAhead(state.job, state.pending)) {
    const made = await ingest(true);
    if (made) {
      state.pending.push({ ...newJob({ masterIssueId: made.id, identifier: made.identifier, nowMs: Date.now() }), brief: made.brief.slice(0, 3000) });
      log(made.identifier + ' direncanakan di muka: Manager menyusun rencana' + (state.job ? ' selagi ' + state.job.identifier + ' berjalan' : ' (mode tinjau)'));
    }
  }
  for (const p of [...state.pending]) {
    if (p.ready || p.hold) continue;
    const facts = await gatherFacts(p, state);
    facts.offline = offline === true;
    const { job, actions } = step(p, facts);
    if (job.phase === 'running') {
      // work order valid: simpan sebagai rencana siap (tahap 1 dibuat saat dipromosikan, bukan sekarang)
      p.ready = true; p.readyMs = Date.now(); p.createdMs = job.createdMs;
      await onPlanAccepted(p, state.job, review);
      if (review) { p.hold = true; p.holdNote = 'menunggu persetujuan rencana oleh owner'; }
      log(p.identifier + ' rencana Manager siap; menunggu giliran');
      continue;
    }
    Object.assign(p, job);
    if (facts.managerFailedError && !isNetworkErr(facts.managerFailedError) && !isManagerRetryable(facts.managerFailedError)) { actions.push({ type: 'block', reason: 'run Manager gagal: ' + String(facts.managerFailedError).slice(0, 120) }); p.phase = 'blocked'; }
    await applyActions(p, actions, facts);
    if (p.phase === 'blocked') { state.history.push({ ...p, endedMs: Date.now() }); state.pending = state.pending.filter((x) => x !== p); }
  }
  if (extraBuffer.length) state.pending.push(...extraBuffer.splice(0));
}

/** Detak jantung 'sibuk sampai': pengawas tidak boleh mengira orkestrator macet saat ia menjalankan panggilan sinkron yang lama. */
const markBusy = (what, ms) => writeHeartbeat(ROOT, 'orchestrator', { ok: true, paperclipOk: true, busy: what, busyUntil: Date.now() + ms });
const isFinished = (j) => ['done', 'blocked'].includes(j.phase);

/**
 * Satu langkah untuk satu konten: kumpulkan fakta, putuskan, terapkan. Konten yang ingin maju ke tahap yang masih dipegang konten di depannya
 * menunggu (laneWait): tiap agent hanya memegang SATU konten pada satu waktu, urutan konten tidak saling mendahului.
 */
async function advanceJob(job, net, occupied, state) {
  const facts = await gatherFacts(job, state);
  facts.offline = net.hold === true;
  const decision = decideAdvance(job, facts, occupied);
  if (decision.wait) {
    if (!job.laneWait) log(job.identifier + ' selesai tahap ' + STAGE_AGENT[STAGES[job.stageIndex]] + '; menunggu tahap berikutnya bebas (jalur perakitan)');
    return decision.job;
  }
  const merged = decision.job;
  const actions = decision.actions;
  if (facts.managerFailedError && !isNetworkErr(facts.managerFailedError) && !isManagerRetryable(facts.managerFailedError)) { actions.push({ type: 'block', reason: 'run Manager gagal: ' + String(facts.managerFailedError).slice(0, 120) }); merged.phase = 'blocked'; }
  await applyActions(merged, actions, facts);
  return merged;
}

async function once() {
  const state = readState();
  state.pending ??= []; state.followers ??= [];
  const settings = readJsonLoose(SETTINGS_FILE) ?? {};
  if (settings.paused === true) {
    // JEDA owner: tidak ada pekerjaan baru; jam tahap/perencanaan dibekukan (seperti offline) supaya tidak ada batas waktu yang lewat; agent yang sedang bekerja menyelesaikan run-nya sendiri.
    const nowMs = Date.now();
    const freeze = (j) => ({ ...j, ...step(j, { offline: true, nowMs }).job });
    if (state.job && !isFinished(state.job)) state.job = freeze(state.job);
    state.followers = state.followers.map((j) => (isFinished(j) ? j : freeze(j)));
    state.pending = state.pending.map((p) => (p.ready || p.hold ? p : freeze(p)));
    if (!state.pausedLogged) { state.pausedLogged = true; log('DIJEDA owner: tidak ada pekerjaan baru; agent yang sedang berjalan menyelesaikan run-nya, jam tahap dibekukan'); }
    if (!DRY) writeState(state);
    return;
  }
  if (state.pausedLogged) { delete state.pausedLogged; log('jeda dicabut: pekerjaan dilanjutkan'); }
  const net = await checkNetwork(state.job);
  try { await tidyBlocked(state); } catch { /* pembersihan hanya kosmetik; jangan pernah mengganggu alur */ }
  try { await processRoutings(); } catch (e) { log('routing revisi galat: ' + String(e?.message ?? e).slice(0, 160)); }
  const review = settings.reviewPlans === true;
  try { await planAhead(state, net.hold, review); } catch (e) { log('perencanaan di muka galat: ' + String(e?.message ?? e).slice(0, 160)); }

  // 1. Majukan semua konten aktif (terdepan dulu). Jalur yang dipegang konten di depan tidak boleh diambil konten di belakangnya.
  const occupied = new Set();
  const advanced = [];
  for (const job of [state.job, ...state.followers].filter(Boolean)) {
    let out = job;
    if (!isFinished(job)) {
      try { out = await advanceJob(job, net, occupied, state); } catch (e) { log(job.identifier + ' galat saat maju: ' + String(e?.message ?? e).slice(0, 160)); }
    }
    advanced.push(out);
    const lane = laneOf(out);
    if (lane !== null) occupied.add(lane);
  }
  // 2. Arsipkan yang selesai/diblokir; konten terdepan berikutnya menjadi state.job.
  const live = [];
  for (const j of advanced) { if (isFinished(j)) state.history.push({ ...j, endedMs: Date.now() }); else live.push(j); }
  state.job = live[0] ?? null; state.followers = live.slice(1);
  if (extraBuffer.length) state.pending.push(...extraBuffer.splice(0));

  // 3. Rencana siap dipromosikan begitu jalur Researcher bebas (Researcher langsung mengambil konten berikutnya selagi konten sebelumnya lanjut ke tahap lain).
  const planned = nextPlanned(state.pending);
  if (planned && canPromote([state.job, ...state.followers].filter(Boolean))) {
    state.pending = state.pending.filter((x) => x !== planned);
    const { ready, readyMs, ...rest } = planned;
    const promoted = { ...rest, phase: 'planning', createdMs: Date.now() }; // work order sudah valid: tick berikutnya langsung membuat tahap 1
    if (!state.job) state.job = promoted; else state.followers.push(promoted);
    log(planned.identifier + ' dipromosikan dari rencana: mulai tahap 1' + (state.job === promoted ? '' : ' (jalur paralel di belakang ' + state.job.identifier + ')'));
  } else if (!state.job && !planned && activePending(state.pending).length === 0) {
    // tidak ada yang berjalan, tidak ada rencana: ambil brief berikutnya dari inbox
    const made = await ingest(false, review);
    if (made) state.job = { ...newJob({ masterIssueId: made.id, identifier: made.identifier, nowMs: Date.now() }), brief: made.brief.slice(0, 3000), ...(made.jobPatch ?? {}) };
  }
  if (!DRY) writeState(state);
}

if (a.includes('--tidy')) {
  const s = readState();
  await tidyStageIssues(null, s.job);
  console.log('rapi-rapi selesai');
} else if (a.includes('--recheck')) {
  // Evaluasi ulang job terblokir TANPA mengulang tahap (mis. keluaran sudah ada tetapi status issue tidak berubah).
  const s = readState();
  const blocked = s.job?.phase === 'blocked' ? s.job : [...s.history].reverse().find((x) => x.phase === 'blocked' && x.stageIndex >= 0);
  if (!blocked) { console.log('Tidak ada job terblokir.'); process.exit(1); }
  s.history = s.history.filter((x) => x.masterIssueId !== blocked.masterIssueId);
  s.job = { ...blocked, phase: 'running' }; // stageStartedMs asli dipertahankan: keluaran yang ditulis selama tahap ini tetap dihitung "segar"
  delete s.job.endedMs; delete s.job.abandoned;
  writeState(s);
  log('job ' + s.job.identifier + ' dievaluasi ulang pada tahap ' + STAGE_AGENT[STAGES[s.job.stageIndex]]);
} else if (a.includes('--retry')) {
  // Ulangi tahap yang terblokir (mis. gangguan penyedia model): buat ulang issue tahap itu dan lanjutkan.
  const s = readState();
  const blocked = s.job?.phase === 'blocked' ? s.job : [...s.history].reverse().find((x) => x.phase === 'blocked' && x.stageIndex >= 0);
  if (blocked && s.job !== blocked) { s.history = s.history.filter((x) => x.masterIssueId !== blocked.masterIssueId); s.job = blocked; delete blocked.endedMs; delete blocked.abandoned; }
  if (!blocked || blocked.stageIndex < 0) { console.log('Tidak ada job terblokir pada suatu tahap.'); process.exit(1); }
  const stageName = STAGES[blocked.stageIndex];
  blocked.phase = 'running'; blocked.stageStartedMs = Date.now(); blocked.stageRetries = 0;
  blocked.stageIssueId = await createStage(blocked, stageName);
  await parkMaster(blocked);
  writeState(s);
  log('tahap ' + STAGE_AGENT[stageName] + ' diulang untuk ' + blocked.identifier);
} else if (a.includes('--resume')) {
  // Lanjutkan job terblokir (terakhir) bila work order-nya kini valid: kembali ke fase planning, orkestrator memulai tahap 1.
  const s = readState();
  const blocked = s.job?.phase === 'blocked' ? s.job : [...s.history].reverse().find((x) => x.phase === 'blocked');
  if (!blocked) { console.log('Tidak ada job terblokir.'); process.exit(0); }
  const ord = existsSync(orderPathFor(blocked.identifier)) ? validateOrder(JSON.parse(readFileSync(orderPathFor(blocked.identifier), 'utf8').replace(/^﻿/, ''))) : null;
  if (!ord?.ok) { console.log('Work order belum valid: ' + (ord ? ord.errors.join('; ') : 'file tidak ada')); process.exit(1); }
  s.history = s.history.filter((x) => x !== blocked && x.masterIssueId !== blocked.masterIssueId);
  s.job = { ...blocked, phase: 'planning', stageIndex: -1, stageIssueId: null, createdMs: Date.now(), planRetries: 0, handledRuns: 0 };
  delete s.job.endedMs; delete s.job.abandoned;
  writeState(s);
  log('job ' + s.job.identifier + ' dilanjutkan dari work order yang valid');
} else if (a.includes('--status')) {
  const s = readState();
  console.log(s.job ? `Job aktif: ${s.job.identifier} fase=${s.job.phase} tahap=${s.job.stageIndex >= 0 ? STAGE_AGENT[STAGES[s.job.stageIndex]] : '-'}` : 'Tidak ada job aktif.');
  console.log(`Selesai/terblokir sebelumnya: ${s.history.length}`);
} else if (a.includes('--watch')) {
  const ms = Number(arg('--interval', 15)) * 1000;
  const lock = acquireLock(ROOT, 'orchestrator');
  if (!lock.ok) { console.error('orkestrator lain sudah berjalan (pid ' + lock.pid + '); keluar'); process.exit(3); }
  process.on('exit', () => releaseLock(lock.file));
  log('watch dimulai (inbox: workspace/inbox)');
  for (;;) {
    let ok = true; let error = null;
    try { await once(); } catch (e) { ok = false; error = String(e?.message ?? e); log(`galat: ${e.message}`); }
    writeHeartbeat(ROOT, 'orchestrator', { ok, paperclipOk: !(error && isConnectionError(error)), error: error ? error.slice(0, 160) : null, intervalMs: ms });
    await new Promise((r) => setTimeout(r, ms));
  }
} else await once();
