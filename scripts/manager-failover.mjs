#!/usr/bin/env node
// manager-failover.mjs — keeps EVERY agent on its best available model (chains in divisions/edukasiai/agent-models.json; Manager: ChatGPT -> Gemini -> Claude).
// Deterministic (no LLM). Only quota / rate-limit / auth failures trigger a switch; normal task failures never do.
// Usage: node scripts/manager-failover.mjs --status | --use <id> | --once | --watch [--interval 30] | --reset
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isOffline, readNetworkState, isNetworkError } from './netcheck.mjs';
import { writeHeartbeat, waitForPaperclip, isConnectionError } from './heartbeat.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FAIL_RE = /acpx_session_init_failed|ensure_session|internal error|quota|rate.?limit|too many requests|\b429\b|exhausted|resource_exhausted|usage limit|limit reached|billing|insufficient|credit|not logged in|login required|authentication required|unauthori[sz]ed|\b401\b|token (has )?expired|overloaded|capacity|terminal service failure|acpx_turn_failed|model.{0,40}(not found|not available|unavailable|does not exist)/i;

export const isFailoverError = (text) => FAIL_RE.test(String(text ?? ''));

/** Index of the next entry after `current`, or null when the chain is exhausted. */
export const nextIndex = (chainLen, current) => (current + 1 < chainLen ? current + 1 : null);

/** Local calendar day key; quotas reset daily, so a new day is a reason to try the priority model again. */
export const dayKey = (ms, offsetMin = 420) => new Date(ms + offsetMin * 60_000).toISOString().slice(0, 10);

/** Never switch adapters while the Manager has a live run: exactly one model works at a time. */
export const isBusy = (runs) => runs.some((r) => ['queued', 'running'].includes(r.status));

/** True when a lock holder with this pid is still alive (single watcher guarantee). */
export function lockHeld(pid, alive = (p) => { try { process.kill(p, 0); return true; } catch { return false; } }) {
  return Number.isInteger(pid) && pid > 0 && pid !== process.pid && alive(pid);
}

export function shouldReset({ currentIdx, lastSwitchMs, nowMs }) {
  return currentIdx > 0 && dayKey(nowMs) !== dayKey(lastSwitchMs);
}

// ── Pergantian dua arah antar penyedia berlangganan (ChatGPT <-> Claude) tanpa bentrok (keputusan owner 2026-10-10) ──
export const HOUR_MS = 3_600_000;
const AUTH_RE = /not logged in|login required|authentication required|unauthori[sz]ed|invalid.*(token|credential)|please (log ?in|sign ?in)/i;
/** Lama sebuah entri diblokir setelah gagal: masalah login 12 jam (butuh owner), kuota/rate-limit 3 jam (jendela umum langganan). */
const RESET_RE = /(?:try again|retry|resets?|available again)[^0-9]{0,25}([0-9]+(?:[.][0-9]+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/i;
export function blockDurationMs(errText) {
  const t = String(errText ?? '');
  if (AUTH_RE.test(t)) return 12 * HOUR_MS;
  const m = RESET_RE.exec(t);
  if (m) { // pesan limit menyebut kapan pulih: pakai itu (dibatasi 5 menit - 24 jam) ditambah 1 menit
    const n = Number(m[1]); const ms = m[2].toLowerCase().startsWith('h') ? n * HOUR_MS : n * 60_000;
    return Math.min(Math.max(ms, 5 * 60_000), 24 * HOUR_MS) + 60_000;
  }
  return 3 * HOUR_MS;
}
export const isBlocked = (blocked, id, nowMs) => (blocked?.[id] ?? 0) > nowMs;
export const pruneBlocked = (blocked = {}, nowMs) => Object.fromEntries(Object.entries(blocked).filter(([, until]) => until > nowMs));
const providerOf = (e) => e.provider ?? e.id;
/**
 * Entri pertama menurut urutan prioritas yang boleh dipakai: bukan yang baru gagal (exclude), tidak diblokir, dan tidak melanggar pengecualian bersama
 * (bila agent lain sedang memakai salah satu penyedia eksklusif, entri eksklusif penyedia lain tidak boleh dipilih).
 */
export function pickEntry({ chain, blocked = {}, nowMs, exclude = null, activeProviders = [], exclusive = [] }) {
  const usable = chain.filter((e) => e.id !== exclude && !isBlocked(blocked, e.id, nowMs));
  const lockedTo = activeProviders.find((p) => exclusive.includes(p));
  const allowed = lockedTo ? usable.filter((e) => !exclusive.includes(providerOf(e)) || providerOf(e) === lockedTo) : usable;
  return allowed[0] ?? null;
}
/** Kembali ke entri berprioritas lebih tinggi bila blokirnya sudah berakhir (hanya dipanggil saat agent menganggur). */
export function returnTarget({ chain, currentIdx, blocked, nowMs, activeProviders, exclusive }) {
  const best = pickEntry({ chain, blocked, nowMs, activeProviders, exclusive });
  const bi = best ? chain.findIndex((e) => e.id === best.id) : -1;
  return bi >= 0 && bi < currentIdx ? best : null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

// Multi-agent: setiap agent di agent-models.json punya rantai modelnya sendiri; keadaan (kapan terakhir berpindah, entri aktif) per agent.
async function main() {
  const a = process.argv.slice(2);
  const arg = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
  const API = arg('--api', 'http://127.0.0.1:3177/api');
  const cfg = JSON.parse(readFileSync(path.join(ROOT, 'divisions', 'edukasiai', 'agent-models.json'), 'utf8'));
  const stateFile = path.join(ROOT, 'workspace', 'failover-state.json');
  const logFile = path.join(ROOT, 'reports', 'failover.log');
  const readAll = () => { try { return JSON.parse(readFileSync(stateFile, 'utf8').replace(/^﻿/, '')); } catch { return {}; } };
  const readState = (name) => readAll()[name] ?? { switchedAtMs: 0, entry: null };
  const writeState = (name, st) => { const all = readAll(); all[name] = st; mkdirSync(path.dirname(stateFile), { recursive: true }); writeFileSync(stateFile, JSON.stringify(all, null, 2)); };
  const log = (m) => { const l = `${new Date().toISOString()} ${m}`; console.log(l); mkdirSync(path.dirname(logFile), { recursive: true }); appendFileSync(logFile, l + '\n'); };

  const j = async (p, o) => { const r = await fetch(API + p, o); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
  const jb = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(body)) });
  if (!(await waitForPaperclip(API, { log, maxMs: a.includes('--watch') ? 20 * 60_000 : 0 })) && a.includes('--watch')) { log('Paperclip tidak siap dalam 20 menit; keluar agar pengawas memulai ulang'); process.exit(1); }
  const company = (await j('/companies')).find((c) => /edukasi/i.test(c.name));
  const agentOf = async (name) => (await j(`/companies/${company.id}/agents`)).find((x) => x.name === name);
  const idxOf = (name, agent) => {
    const chain = cfg.agents[name];
    const byState = chain.findIndex((e) => e.id === readState(name).entry);
    if (byState >= 0) return byState;
    const byAdapter = chain.findIndex((e) => e.adapterType === agent.adapterType && (e.adapterConfig.model ?? null) === (agent.adapterConfig?.model ?? null));
    return byAdapter; // -1 = di luar rantai
  };

  const dotenv = () => {
    const f = path.join(ROOT, '.env');
    const m = new Map();
    if (existsSync(f)) for (const l of readFileSync(f, 'utf8').split(/\r?\n/)) { const i = l.indexOf('='); if (i > 0) m.set(l.slice(0, i), l.slice(i + 1).trim()); }
    return m;
  };

  async function apply(name, entry, why) {
    const agent = await agentOf(name);
    const live = (await j(`/companies/${company.id}/heartbeat-runs?limit=60`)).filter((r) => r.agentId === agent.id);
    if (isBusy(live) && !a.includes('--force')) { log(`ditunda: ${name} sedang menjalankan run, tidak ganti model ke ${entry.label}`); return false; }
    const base = { cwd: path.join(ROOT, 'workspace', 'agent'), timeoutSec: 1500, nonInteractivePermissions: 'deny' };
    const env = { ...(entry.adapterConfig.env ?? {}) };
    const de = dotenv();
    for (const spec of entry.envFromDotenv ?? []) { const [k, src = k] = spec.split('='); if (!de.has(src)) throw new Error(`${src} tidak ada di .env`); env[k] = de.get(src); }
    // PATCH menggabungkan config lama; kunci model dari adapter sebelumnya harus dikosongkan bila entri tidak menyebut model.
    const adapterConfig = { ...base, ...(entry.adapterConfig.model ? {} : { model: null }), ...entry.adapterConfig, ...(Object.keys(env).length ? { env } : {}) };
    await j(`/agents/${agent.id}`, jb('PATCH', { adapterType: entry.adapterType, adapterConfig }));
    await j(`/agents/${agent.id}/resume`, jb('POST', {}));
    writeState(name, { ...readState(name), switchedAtMs: Date.now(), entry: entry.id });
    log(`${name} -> ${entry.label} (${entry.adapterType}) — ${why}`);
    return true;
  }

  /** Penyedia eksklusif yang SEDANG dipakai agent lain (run aktif), supaya ChatGPT dan Claude tidak berjalan bersamaan. */
  async function activeProvidersExcept(name) {
    const out = new Set();
    const all = await j(`/companies/${company.id}/agents`);
    const runs = await j(`/companies/${company.id}/heartbeat-runs?limit=60`);
    for (const other of Object.keys(cfg.agents)) {
      if (other === name) continue;
      const ag = all.find((x) => x.name === other);
      if (!ag || !isBusy(runs.filter((r) => r.agentId === ag.id))) continue;
      const cur = cfg.agents[other][idxOf(other, ag)];
      if (cur) out.add(providerOf(cur));
    }
    return [...out];
  }

  async function once(name) {
    const chain = cfg.agents[name];
    const exclusive = cfg.exclusiveProviders ?? [];
    const agent = await agentOf(name);
    if (!agent) return;
    const idx = idxOf(name, agent);
    const nowMs = Date.now();
    let st = readState(name);
    st = { ...st, blocked: pruneBlocked(st.blocked, nowMs) };
    // Pemulihan setelah internet kembali: agent berstatus error karena galat jaringan di-resume otomatis (tanpa trigger tambahan).
    if (agent.status === 'error' && !isOffline(readNetworkState(path.join(ROOT, 'workspace', 'network-state.json')))) {
      const recent = (await j(`/companies/${company.id}/heartbeat-runs?limit=60`)).filter((r) => r.agentId === agent.id && r.status !== 'cancelled' && r.status !== 'scheduled_retry')[0];
      if (recent && isNetworkError(`${recent.error ?? ''} ${recent.errorCode ?? ''}`)) {
        await j(`/agents/${agent.id}/resume`, jb('POST', {}));
        log(`${name} dipulihkan otomatis setelah galat jaringan`);
        return;
      }
    }
    const allRuns = (await j(`/companies/${company.id}/heartbeat-runs?limit=60`)).filter((r) => r.agentId === agent.id);
    const busy = isBusy(allRuns);
    const activeProviders = await activeProvidersExcept(name);
    const cur = chain[idx];
    // Hari baru: blokir dihapus dan kembali ke prioritas utama.
    if (shouldReset({ currentIdx: idx, lastSwitchMs: st.switchedAtMs, nowMs })) { writeState(name, { ...st, blocked: {} }); return apply(name, chain[0], 'hari baru, kembali ke prioritas utama'); }
    // Di luar rantai (mis. model manual/warisan): kembali ke rantai bila menganggur.
    if (idx < 0) {
      if (busy) return;
      const t = pickEntry({ chain, blocked: st.blocked, nowMs, activeProviders, exclusive });
      if (t) { writeState(name, st); return apply(name, t, 'di luar rantai model, kembali ke rantai'); }
      return;
    }
    // Entri aktif diblokir (mis. dipakai owner/gagal) dan agent menganggur: pindah ke yang tersedia, dua arah.
    if (isBlocked(st.blocked, cur.id, nowMs) && !busy) {
      const t = pickEntry({ chain, blocked: st.blocked, nowMs, exclude: cur.id, activeProviders, exclusive });
      if (t) { writeState(name, st); return apply(name, t, `${cur.label} sedang diblokir; ${t.label} mengambil alih`); }
      return log(`SEMUA model ${name} diblokir/gagal; butuh owner (login ulang atau tunggu kuota)`);
    }
    // Blokir entri berprioritas lebih tinggi sudah berakhir: kembali (hanya saat menganggur).
    if (!busy) {
      const back = returnTarget({ chain, currentIdx: idx, blocked: st.blocked, nowMs, activeProviders, exclusive });
      if (back) { writeState(name, st); return apply(name, back, `${back.label} tersedia lagi, kembali ke prioritas`); }
    }
    // Run yang dibatalkan (mis. agent sedang di-pause) bukan bukti kuota/model; yang dinilai adalah run terakhir yang benar-benar berjalan.
    const last = allRuns.filter((r) => r.status !== 'cancelled')[0];
    if (!last || Date.parse(last.startedAt ?? 0) <= st.switchedAtMs) { if (st.blocked && Object.keys(st.blocked).length !== Object.keys(readState(name).blocked ?? {}).length) writeState(name, st); return; }
    if (!['failed', 'error', 'timed_out'].includes(last.status)) return;
    const errText = `${last.error ?? ''} ${last.errorCode ?? ''}`;
    // Putus internet BUKAN masalah model: jangan pernah berpindah model karenanya (orkestrator menahan dan melanjutkan sendiri).
    if (isNetworkError(errText) || isOffline(readNetworkState(path.join(ROOT, 'workspace', 'network-state.json')))) return;
    if (!isFailoverError(errText)) return; // galat tugas biasa / galat sementara: bukan urusan failover
    // Gagal karena kuota/login: blokir entri ini, lalu pilih yang lain menurut prioritas (ChatGPT <-> Claude bergantian, Gemini cadangan terakhir).
    st.blocked = { ...st.blocked, [cur.id]: nowMs + blockDurationMs(errText) };
    writeState(name, st);
    const t = pickEntry({ chain, blocked: st.blocked, nowMs, exclude: cur.id, activeProviders, exclusive });
    if (!t) return log(`SEMUA model ${name} habis/gagal; butuh owner (login ulang atau tunggu kuota)`);
    await apply(name, t, `${cur.label} gagal (${String(last.error).slice(0, 80)}); diblokir ${Math.round(blockDurationMs(errText) / HOUR_MS)} jam`);
  }

  const names = arg('--agent') ? [arg('--agent')] : Object.keys(cfg.agents);
  if (a.includes('--status')) {
    for (const name of names) {
      const agent = await agentOf(name);
      const ix = idxOf(name, agent);
      const bl = Object.entries(pruneBlocked(readState(name).blocked, Date.now())).map(([id, until]) => `${id} sampai ${new Date(until).toISOString().slice(11, 16)}Z`);
      console.log(`${name}: ${agent.adapterType}${agent.adapterConfig?.model ? ' ' + agent.adapterConfig.model : ''} (${agent.status}), ${ix < 0 ? 'DI LUAR rantai' : `urutan ${ix + 1}/${cfg.agents[name].length}`}${bl.length ? ' · diblokir: ' + bl.join(', ') : ''}`);
    }
    for (const t of ['codex_local', 'gemini_local', 'claude_local']) console.log(`- auth ${t}: ${JSON.stringify(await j(`/companies/${company.id}/adapters/${t}/auth-signal`))}`);
  } else if (a.includes('--block') || a.includes('--unblock')) {
    // Penyedia sedang dipakai owner (mis. sesi Claude Code/ChatGPT pribadi): blokir sementara agar agent memakai yang lain.
    const name = arg('--agent', 'Manager');
    const id = arg('--block') ?? arg('--unblock');
    if (!cfg.agents[name].some((x) => x.id === id)) throw new Error(`id tidak dikenal: ${cfg.agents[name].map((x) => x.id).join('|')}`);
    const st = readState(name);
    const blocked = pruneBlocked(st.blocked, Date.now());
    if (a.includes('--block')) blocked[id] = Date.now() + Number(arg('--hours', 2)) * HOUR_MS; else delete blocked[id];
    writeState(name, { ...st, blocked });
    log(`${name}: ${id} ${a.includes('--block') ? 'DIBLOKIR ' + arg('--hours', 2) + ' jam (dipakai owner)' : 'dibuka blokirnya'}`);
    await once(name);
  } else if (a.includes('--use')) {
    const name = arg('--agent', 'Manager');
    const e = cfg.agents[name].find((x) => x.id === arg('--use'));
    if (!e) throw new Error(`id tidak dikenal: ${cfg.agents[name].map((x) => x.id).join('|')}`);
    await apply(name, e, 'dipilih manual');
  } else if (a.includes('--reset')) {
    for (const name of names) { writeState(name, { ...readState(name), blocked: {} }); await apply(name, cfg.agents[name][0], 'reset ke prioritas utama'); }
  } else if (a.includes('--watch')) {
    const ms = Number(arg('--interval', 30)) * 1000;
    const lockFile = path.join(ROOT, 'workspace', 'failover.lock');
    if (existsSync(lockFile) && lockHeld(Number(readFileSync(lockFile, 'utf8')))) { console.error('watcher lain sudah berjalan; keluar'); process.exit(3); }
    mkdirSync(path.dirname(lockFile), { recursive: true });
    writeFileSync(lockFile, String(process.pid));
    log(`watch dimulai untuk: ${names.join(', ')}`);
    for (;;) {
      let connOk = true; let err = null;
      for (const name of names) { try { await once(name); } catch (e) { log(`galat ${name}: ${e.message}`); err = String(e?.message ?? e); if (isConnectionError(err)) connOk = false; } }
      writeHeartbeat(ROOT, 'failover', { ok: err === null, paperclipOk: connOk, error: err ? err.slice(0, 160) : null, intervalMs: ms });
      await new Promise((r) => setTimeout(r, ms));
    }
  } else for (const name of names) await once(name);
}
