#!/usr/bin/env node
// office-launcher.mjs — pengawas seluruh stack AI Office: menyalakan, memastikan TERHUBUNG ke Paperclip, memulihkan yang putus, dan melapor.
// Urutan: Paperclip dulu (tunggu sehat) -> orkestrator + failover (butuh Paperclip) ; Office View (toleran, boleh lebih dulu).
// Tiap komponen diawasi lewat detak jantung dan probe nyata (bukan sekadar "proses hidup"); status ditulis ke workspace/launcher-status.json.
//
// Pemakaian:
//   node scripts/office-launcher.mjs [--no-open] [--port 3190] [--public]      jalankan pengawas (dipanggil AIOffice.exe)
//   node scripts/office-launcher.mjs --status                                 tampilkan status terakhir
//   node scripts/office-launcher.mjs --command shutdown|stop-now|open|restart [komponen]   kirim perintah ke pengawas yang berjalan
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import net from 'node:net';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, truncateSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateHealth, backoffMs, crashLoop, shouldRestart, summaryLine } from './connectivity.mjs';
import { readHeartbeat, acquireLock, releaseLock } from './heartbeat.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const a = process.argv.slice(2);
const arg = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const API = (process.env.AAO_API_BASE ?? 'http://127.0.0.1:3177').replace(/\/+$/, '');
const PORT = Number(arg('--port', process.env.AAO_OFFICE_PORT ?? 3190));
const UI = `http://127.0.0.1:${PORT}`;
const PUBLIC = a.includes('--public');
const f = (...p) => path.join(ROOT, ...p);
const STATUS_FILE = f('workspace', 'launcher-status.json');
const COMMAND_FILE = f('workspace', 'launcher.command');
const SETTINGS_FILE = f('workspace', 'orchestrator-settings.json');
const LOG_FILE = f('reports', 'launcher.log');
const NODE = process.execPath;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NL = String.fromCharCode(10);

function log(m) { const l = `${new Date().toISOString()} ${m}`; try { mkdirSync(path.dirname(LOG_FILE), { recursive: true }); appendFileSync(LOG_FILE, l + NL); } catch { /* log gagal tidak boleh menjatuhkan pengawas */ } if (process.stdout.isTTY) console.log(l); }
const readJson = (file, d = null) => { try { return JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return d; } };
async function fetchJson(url, ms = 6000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms), cache: 'no-store' });
  const t = await r.text();
  try { return { status: r.status, ok: r.ok, data: JSON.parse(t) }; } catch { return { status: r.status, ok: r.ok, data: null }; }
}

// ───────── CLI ringan (tanpa menjalankan pengawas) ─────────
if (a.includes('--status')) {
  const s = readJson(STATUS_FILE);
  console.log(s ? JSON.stringify(s, null, 2) : 'Belum ada status: pengawas belum pernah berjalan.');
  process.exit(0);
}
if (a.includes('--command')) {
  const cmd = arg('--command');
  if (!['shutdown', 'stop-now', 'open', 'restart'].includes(cmd)) { console.error('perintah: shutdown | stop-now | open | restart [komponen]'); process.exit(64); }
  mkdirSync(path.dirname(COMMAND_FILE), { recursive: true });
  writeFileSync(COMMAND_FILE, JSON.stringify({ cmd, key: a[a.indexOf('--command') + 2] ?? null, at: Date.now() }) + NL);
  console.log(`Perintah "${cmd}" dikirim.`);
  process.exit(0);
}

// ───────── pengawas ─────────
const lock = acquireLock(ROOT, 'launcher');
if (!lock.ok) { console.error(`Pengawas lain sudah berjalan (pid ${lock.pid}).`); process.exit(3); }
process.on('exit', () => releaseLock(lock.file));

/** Definisi komponen. needsPaperclip: baru dinyalakan setelah Paperclip terbukti sehat (menghindari kegagalan awal). */
const DEFS = [
  { key: 'office-view', label: 'Office View', needsPaperclip: false, match: 'apps/office-view/server.mjs', args: ['apps/office-view/server.mjs', '--port', String(PORT), '--paperclip', API, '--enable-talk', '--enable-owner', ...(PUBLIC ? ['--public'] : [])] },
  { key: 'orchestrator', label: 'Orkestrator', needsPaperclip: true, match: 'scripts/orchestrator.mjs', args: ['scripts/orchestrator.mjs', '--watch'] },
  { key: 'failover', label: 'Failover model', needsPaperclip: true, match: 'scripts/manager-failover.mjs', args: ['scripts/manager-failover.mjs', '--watch'] },
];
const comp = new Map(DEFS.map((d) => [d.key, { def: d, child: null, pid: null, adopted: false, restarts: [], nextStartAt: 0, badSince: null, failed: false }]));
let pcMisses = 0; let lastGoodPaperclip = null;
/** Port terbuka = prosesnya masih ada (mungkin hanya lambat): jangan pernah meluncurkan Paperclip kedua. */
const tcpOpen = (port) => new Promise((resolve) => { const s = net.connect({ host: '127.0.0.1', port, timeout: 2000 }); s.once('connect', () => { s.destroy(); resolve(true); }); s.once('error', () => resolve(false)); s.once('timeout', () => { s.destroy(); resolve(false); }); });
let stopping = false; let paperclipRestartAt = 0; let paperclipDownSince = null; let opened = false; const startedAt = Date.now();
// Paperclip butuh beberapa menit untuk start (pemulihan Postgres tertanam); jangan diluncurkan ulang selama masa tunggu ini.
const PAPERCLIP_STARTUP_GRACE_MS = 8 * 60_000;

/** Proses node yang sudah berjalan (mis. dinyalakan manual): diadopsi, bukan digandakan. */
function listNodeProcs() {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"], { encoding: 'utf8', timeout: 25_000, windowsHide: true });
    const j = JSON.parse(out || '[]');
    return (Array.isArray(j) ? j : [j]).filter((x) => x?.CommandLine).map((x) => ({ pid: x.ProcessId, cmd: String(x.CommandLine).replace(/\\/g, '/') }));
  } catch { return []; }
}
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

function rotateLog(file) { try { if (existsSync(file) && statSync(file).size > 5 * 1024 * 1024) truncateSync(file, 0); } catch { /* abaikan */ } }
function spawnComponent(c) {
  mkdirSync(f('reports'), { recursive: true });
  const outFile = f('reports', `${c.def.key}.out.log`);
  rotateLog(outFile);
  const fd = openSync(outFile, 'a');
  const child = spawn(NODE, c.def.args, { cwd: ROOT, windowsHide: true, stdio: ['ignore', fd, fd], env: { ...process.env, AAO_API_BASE: API } });
  closeSync(fd);
  c.child = child; c.pid = child.pid; c.adopted = false; c.badSince = null;
  c.restarts.push(Date.now()); c.restarts = c.restarts.filter((t) => Date.now() - t < 10 * 60_000);
  log(`${c.def.label} dinyalakan (pid ${child.pid})`);
  child.on('exit', (code) => {
    log(`${c.def.label} berhenti (kode ${code})`);
    c.child = null; c.pid = null;
    c.nextStartAt = Date.now() + backoffMs(Math.max(0, c.restarts.filter((t) => Date.now() - t < 5 * 60_000).length - 1));
  });
}
const isAlive = (c) => (c.child ? c.child.exitCode === null : c.pid ? pidAlive(c.pid) : false);
function killComponent(c) {
  try { if (c.child) c.child.kill(); else if (c.pid) process.kill(c.pid); } catch { /* sudah mati */ }
  c.child = null; c.pid = null; c.adopted = false;
}

function startPaperclip(why) {
  log(`Menyalakan Paperclip (${why})`);
  paperclipRestartAt = Date.now();
  // Terbukti (Fase 0): Paperclip mati bila diluncurkan sebagai anak langsung; harus proses PowerShell tersembunyi terpisah lewat Start-Process.
  const script = f('scripts', 'start-paperclip.ps1').replace(/'/g, "''");
  const cmd = `Start-Process -WindowStyle Hidden -FilePath powershell.exe -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File','${script}'`;
  const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { cwd: ROOT, windowsHide: true, stdio: 'ignore' });
  p.on('error', (e) => log(`Gagal menyalakan Paperclip: ${e.message}`));
  p.unref();
}

// Detak jantung milik proses yang sudah mati (sesi sebelumnya) tidak boleh terbaca sebagai "hidup".
const liveHeartbeat = (key, alive) => { const h = readHeartbeat(ROOT, key); return h && !alive[key] && h.pid !== undefined && !pidAlive(h.pid) ? null : h; };

// ───────── probe ─────────
async function probe() {
  const nowMs = Date.now();
  let paperclip = { reachable: false };
  // Lag sesaat (PC berat) jangan langsung dihitung putus: 12 dtk per percobaan, dan 2 kegagalan beruntun masih memakai hasil terakhir yang baik.
  try { const r = await fetchJson(`${API}/api/health`, 12000); if (r.data) { paperclip = { reachable: true, status: r.data.status, version: r.data.version }; pcMisses = 0; lastGoodPaperclip = paperclip; } else pcMisses++; } catch { pcMisses++; }
  if (!paperclip.reachable && pcMisses < 3 && lastGoodPaperclip) paperclip = lastGoodPaperclip;
  const pcOk = paperclip.reachable && paperclip.status === 'ok';

  let plugin = { ready: null }; let agents = { count: null, expected: 6 };
  if (pcOk) {
    try {
      const r = await fetchJson(`${API}/api/plugins`, 6000);
      const list = Array.isArray(r.data) ? r.data : r.data?.plugins ?? null;
      if (list) { const p = list.find((x) => JSON.stringify(x).includes('aao-approval-gate')); plugin = { ready: p ? /ready/i.test(JSON.stringify(p.status ?? p.state ?? p)) : false }; }
    } catch { plugin = { ready: null }; }
    try {
      const cs = (await fetchJson(`${API}/api/companies`, 6000)).data ?? [];
      const co = cs.find((c) => /edukasi/i.test(c.name) && !/mega\s*class/i.test(c.name));
      if (co) agents = { count: ((await fetchJson(`${API}/api/companies/${co.id}/agents`, 6000)).data ?? []).length, expected: 6 };
    } catch { agents = { count: null, expected: 6 }; }
  }

  let officeView = { reachable: false, connected: null };
  try { const r = await fetchJson(`${UI}/api/status`, 5000); if (r.data) officeView = { reachable: true, connected: r.data.connected }; } catch { /* UI belum menjawab */ }

  const alive = { orchestrator: isAlive(comp.get('orchestrator')), failover: isAlive(comp.get('failover')) };
  return { pcOk, input: { nowMs, paperclip, plugin, agents, officeView, orchestrator: liveHeartbeat('orchestrator', alive), failover: liveHeartbeat('failover', alive), alive } };
}

let lastStatusSig = '';
function writeStatus(health, extra) {
  const settings = readJson(SETTINGS_FILE, {});
  const status = { at: Date.now(), startedAt, pid: process.pid, ui: UI, public: PUBLIC, overall: health.overall, summary: summaryLine({ ...health, paused: settings.paused === true }), paused: settings.paused === true, components: health.components.map((c) => ({ ...c, restarts: comp.get(c.key)?.restarts.length ?? 0, pid: comp.get(c.key)?.pid ?? null })), problems: health.problems, ...extra };
  try { mkdirSync(path.dirname(STATUS_FILE), { recursive: true }); writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2) + NL); } catch { /* abaikan */ }
  const sig = `${health.overall}|${health.problems.join(';')}`;
  if (sig !== lastStatusSig) { log(`status: ${status.summary}${health.problems.length ? ' — ' + health.problems.join(' | ') : ''}`); lastStatusSig = sig; }
}

// ───────── perintah dari tray ─────────
async function runningAgents() {
  try {
    const cs = (await fetchJson(`${API}/api/companies`, 6000)).data ?? [];
    const co = cs.find((c) => /edukasi/i.test(c.name) && !/mega\s*class/i.test(c.name));
    return ((await fetchJson(`${API}/api/companies/${co.id}/agents`, 6000)).data ?? []).filter((x) => x.status === 'running').map((x) => x.name);
  } catch { return []; }
}
function setPaused(v) { const s = readJson(SETTINGS_FILE, {}); s.paused = v; mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true }); writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2) + NL); }

/** Matikan aman: jeda (tidak ada pekerjaan baru, jam dibekukan), tunggu agent yang berjalan selesai (maks 20 menit), lalu hentikan semuanya. */
async function safeShutdown() {
  stopping = true;
  log('Mematikan dengan aman: jeda dan menunggu agent yang sedang bekerja');
  setPaused(true);
  const t0 = Date.now();
  for (;;) {
    const run = await runningAgents();
    writeStatus(evaluateHealth((await probe()).input), { shutting: true, waiting: run });
    if (!run.length || Date.now() - t0 > 20 * 60_000) break;
    await sleep(5000);
  }
  stopAll(true);
}
function stopAll(stopPaperclipToo) {
  stopping = true;
  for (const c of comp.values()) killComponent(c);
  if (stopPaperclipToo) { try { spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', f('scripts', 'start-paperclip.ps1'), '-Stop'], { cwd: ROOT, windowsHide: true, timeout: 60_000 }); } catch { /* abaikan */ } }
  try { writeFileSync(STATUS_FILE, JSON.stringify({ at: Date.now(), overall: 'mati', summary: 'Dimatikan', components: [], problems: [], paused: readJson(SETTINGS_FILE, {}).paused === true }, null, 2) + NL); } catch { /* abaikan */ }
  log('Semua dihentikan');
  process.exit(0);
}
async function handleCommand() {
  const c = readJson(COMMAND_FILE);
  if (!c) return;
  try { unlinkSync(COMMAND_FILE); } catch { /* sudah hilang */ }
  log(`perintah dari tray: ${c.cmd}${c.key ? ' ' + c.key : ''}`);
  if (c.cmd === 'open') spawn('cmd', ['/c', 'start', '', UI], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  else if (c.cmd === 'restart') { const x = c.key ? comp.get(c.key) : null; if (x) { killComponent(x); x.nextStartAt = 0; x.failed = false; } else if (c.key === 'paperclip') startPaperclip('perintah owner'); }
  else if (c.cmd === 'stop-now') stopAll(false);
  else if (c.cmd === 'shutdown') await safeShutdown();
}

// ───────── siklus utama ─────────
async function cycle() {
  const nowMs = Date.now();
  const { pcOk, input } = await probe();
  const health = evaluateHealth(input);

  // Paperclip: bila tidak terjangkau cukup lama, nyalakan ulang (dengan jeda agar tidak berulang-ulang).
  if (!input.paperclip.reachable) {
    paperclipDownSince ??= nowMs;
    if (nowMs - paperclipDownSince > 30_000 && nowMs - paperclipRestartAt > PAPERCLIP_STARTUP_GRACE_MS) { if (await tcpOpen(3177)) log('Paperclip lambat tetapi prosesnya hidup (port 3177 terbuka): tidak diluncurkan ulang'); else startPaperclip('tidak terjangkau'); }
  } else paperclipDownSince = null;

  // Komponen: nyalakan yang belum berjalan, pulihkan yang mati/tidak terhubung.
  const procsOnce = { list: null };
  for (const c of comp.values()) {
    const h = health.components.find((x) => x.key === c.def.key);
    const alive = isAlive(c);
    if (h.state === 'ok' || h.state === 'mulai') c.badSince = null; else c.badSince ??= nowMs;
    if (stopping) continue;
    if (c.def.needsPaperclip && !pcOk) continue; // tunggu Paperclip sehat dulu
    if (!alive) {
      if (crashLoop(c.restarts, nowMs)) { if (!c.failed) { c.failed = true; log(`${c.def.label}: terlalu sering berhenti; pemulihan otomatis dihentikan (butuh perhatian)`); } continue; }
      if (nowMs < c.nextStartAt) continue;
      procsOnce.list ??= listNodeProcs();
      const existing = procsOnce.list.find((p) => p.cmd.includes(c.def.match) && p.cmd.includes(ROOT.replace(/\\/g, '/')) !== false);
      if (existing && pidAlive(existing.pid)) { c.pid = existing.pid; c.adopted = true; log(`${c.def.label}: memakai proses yang sudah berjalan (pid ${existing.pid})`); continue; }
      spawnComponent(c);
      continue;
    }
    const d = shouldRestart({ state: h.state, sinceMs: c.badSince, nowMs, paperclipOk: pcOk });
    if (d.restart && !c.failed) { log(`${c.def.label}: dimulai ulang (${d.why})`); killComponent(c); c.nextStartAt = nowMs + 2000; }
  }

  writeStatus(health, { shutting: false });
  if (!opened && !a.includes('--no-open') && health.components.find((x) => x.key === 'office-view')?.state === 'ok') {
    opened = true; spawn('cmd', ['/c', 'start', '', UI], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  }
}

process.on('SIGINT', () => stopAll(false));
process.on('SIGTERM', () => stopAll(false));
log(`Pengawas dimulai (Paperclip ${API}, UI ${UI}${PUBLIC ? ', MODE PUBLIK' : ''})`);
const first = await fetchJson(`${API}/api/health`, 4000).catch(() => null);
if (!first?.data) startPaperclip('belum berjalan saat pengawas dimulai');
for (;;) {
  try { await cycle(); await handleCommand(); } catch (e) { log(`galat siklus: ${String(e?.message ?? e).slice(0, 160)}`); }
  await sleep(5000);
}
