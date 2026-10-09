#!/usr/bin/env node
// manager-failover.mjs — keeps the Manager on the best available model: ChatGPT -> Gemini -> Claude.
// Deterministic (no LLM). Only quota / rate-limit / auth failures trigger a switch; normal task failures never do.
// Usage: node scripts/manager-failover.mjs --status | --use <id> | --once | --watch [--interval 30] | --reset
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FAIL_RE = /quota|rate.?limit|too many requests|\b429\b|exhausted|resource_exhausted|usage limit|limit reached|billing|insufficient|credit|not logged in|login required|authentication required|unauthori[sz]ed|\b401\b|token (has )?expired|overloaded|capacity|terminal service failure|acpx_turn_failed|model.{0,40}(not found|not available|unavailable|does not exist)/i;

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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

async function main() {
  const a = process.argv.slice(2);
  const arg = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
  const API = arg('--api', 'http://127.0.0.1:3177/api');
  const cfg = JSON.parse(readFileSync(path.join(ROOT, 'divisions', 'edukasiai', 'manager-models.json'), 'utf8'));
  const stateFile = path.join(ROOT, 'workspace', 'failover-state.json');
  const logFile = path.join(ROOT, 'reports', 'failover.log');
  const readState = () => (existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { switchedAtMs: 0 });
  const log = (m) => { const l = `${new Date().toISOString()} ${m}`; console.log(l); mkdirSync(path.dirname(logFile), { recursive: true }); appendFileSync(logFile, l + '\n'); };

  const j = async (p, o) => { const r = await fetch(API + p, o); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
  const jb = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(body)) });
  const company = (await j('/companies')).find((c) => /edukasi/i.test(c.name));
  const agentOf = async () => (await j(`/companies/${company.id}/agents`)).find((x) => x.name === cfg.agent);
  const idxOf = (agent) => Math.max(0, cfg.chain.findIndex((e) => e.adapterType === agent.adapterType));

  const dotenv = () => {
    const f = path.join(ROOT, '.env');
    const m = new Map();
    if (existsSync(f)) for (const l of readFileSync(f, 'utf8').split(/\r?\n/)) { const i = l.indexOf('='); if (i > 0) m.set(l.slice(0, i), l.slice(i + 1).trim()); }
    return m;
  };

  async function apply(entry, why) {
    const agent = await agentOf();
    const live = (await j(`/companies/${company.id}/heartbeat-runs?limit=30`)).filter((r) => r.agentId === agent.id);
    if (isBusy(live) && !a.includes('--force')) { log(`ditunda: Manager sedang menjalankan run, tidak ganti model ke ${entry.label}`); return false; }
    const base = { cwd: path.join(ROOT, 'workspace', 'agent'), timeoutSec: 1500, nonInteractivePermissions: 'deny' };
    const env = { ...(entry.adapterConfig.env ?? {}) };
    const de = dotenv();
    for (const k of entry.envFromDotenv ?? []) { if (!de.has(k)) throw new Error(`${k} tidak ada di .env`); env[k] = de.get(k); }
    // PATCH menggabungkan config lama; kunci model dari adapter sebelumnya harus dikosongkan bila entri tidak menyebut model.
    const adapterConfig = { ...base, ...(entry.adapterConfig.model ? {} : { model: null }), ...entry.adapterConfig, ...(Object.keys(env).length ? { env } : {}) };
    await j(`/agents/${agent.id}`, jb('PATCH', { adapterType: entry.adapterType, adapterConfig }));
    await j(`/agents/${agent.id}/resume`, jb('POST', {}));
    mkdirSync(path.dirname(stateFile), { recursive: true });
    writeFileSync(stateFile, JSON.stringify({ switchedAtMs: Date.now(), entry: entry.id }));
    log(`Manager -> ${entry.label} (${entry.adapterType}) — ${why}`);
    return true;
  }

  async function once() {
    const agent = await agentOf();
    const idx = idxOf(agent);
    const st = readState();
    if (shouldReset({ currentIdx: idx, lastSwitchMs: st.switchedAtMs, nowMs: Date.now() })) return apply(cfg.chain[0], 'hari baru, kembali ke prioritas utama');
    const runs = (await j(`/companies/${company.id}/heartbeat-runs?limit=30`)).filter((r) => r.agentId === agent.id);
    const last = runs[0];
    if (!last || Date.parse(last.startedAt ?? 0) <= st.switchedAtMs) return;
    if (!['failed', 'error', 'timed_out'].includes(last.status)) return;
    if (!isFailoverError(`${last.error ?? ''} ${last.errorCode ?? ''}`)) return log(`run gagal bukan karena kuota/auth, tidak ganti model: ${String(last.error).slice(0, 80)}`);
    const n = nextIndex(cfg.chain.length, idx);
    if (n === null) return log('SEMUA model Manager habis/gagal; butuh owner (login ulang atau tunggu kuota)');
    await apply(cfg.chain[n], `run gagal: ${String(last.error).slice(0, 80)}`);
  }

  if (a.includes('--status')) {
    const agent = await agentOf();
    console.log(`Manager: ${agent.adapterType} (${agent.status}), urutan ${idxOf(agent) + 1}/${cfg.chain.length}`);
    for (const e of cfg.chain) console.log(`- ${e.label}: auth ${JSON.stringify(await j(`/companies/${company.id}/adapters/${e.adapterType}/auth-signal`))}`);
  } else if (a.includes('--use')) {
    const e = cfg.chain.find((x) => x.id === arg('--use'));
    if (!e) throw new Error(`id tidak dikenal: ${cfg.chain.map((x) => x.id).join('|')}`);
    await apply(e, 'dipilih manual');
  } else if (a.includes('--reset')) {
    await apply(cfg.chain[0], 'reset ke prioritas utama');
  } else if (a.includes('--watch')) {
    const ms = Number(arg('--interval', 30)) * 1000;
    const lockFile = path.join(ROOT, 'workspace', 'failover.lock');
    if (existsSync(lockFile) && lockHeld(Number(readFileSync(lockFile, 'utf8')))) { console.error('watcher lain sudah berjalan; keluar'); process.exit(3); }
    mkdirSync(path.dirname(lockFile), { recursive: true });
    writeFileSync(lockFile, String(process.pid));
    log('watch dimulai');
    for (;;) { try { await once(); } catch (e) { log(`galat: ${e.message}`); } await new Promise((r) => setTimeout(r, ms)); }
  } else await once();
}
