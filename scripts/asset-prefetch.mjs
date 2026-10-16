// Early image capture: start fetching real brand/product images as soon as the Designer has written asset-requests.json,
// while the Designer is still composing carousel-design.json. The gate later finds the manifest ready instead of blocking
// the whole orchestrator for minutes on a synchronous capture.
//
// Rules:
//  - one capture at a time (all captures share one Edge profile; two at once would collide);
//  - never re-run for the same request set (same signature), so a CAPTCHA wall is not hammered; a changed request file or
//    new owner files in the inbox change the signature and allow a new attempt;
//  - the capture process is detached from the event loop (async spawn), so other jobs keep moving.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import path from 'node:path';

// Catatan "permintaan ini sudah dicoba" disimpan ke disk: restart orkestrator tidak boleh mengulang pencarian yang sama (menghemat waktu dan CAPTCHA Google).
const DONE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'workspace', 'prefetch-done.json');
const loadDone = () => { try { return new Map(Object.entries(JSON.parse(readFileSync(DONE_FILE, 'utf8')))); } catch { return new Map(); } };
const saveDone = (m) => { try { mkdirSync(path.dirname(DONE_FILE), { recursive: true }); writeFileSync(DONE_FILE, JSON.stringify(Object.fromEntries([...m].slice(-50)))); } catch { /* kosmetik */ } };
const state = { child: null, runKey: null, done: loadDone() };

export const prefetchRunning = () => state.child !== null;
export const prefetchDoneFor = (runKey, sig) => state.done.get(runKey) === sig;

/** Signature of one request set: file content plus the owner-inbox signature. */
export const requestsSig = (rawRequests, inboxSig) => createHash('sha1').update(String(rawRequests)).update('|').update(String(inboxSig ?? '')).digest('hex').slice(0, 16);

/**
 * Pure decision: should an early capture start now?
 * mtimeMs/stageStartedMs: the request file must be fresh (written during this stage) and stable (not still being written).
 */
export function shouldPrefetch({ reqExists, mtimeMs, stageStartedMs, nowMs, running, complete, lastSig, sig, stableMs = 20_000 }) {
  if (!reqExists || running || complete) return false;
  if (mtimeMs < stageStartedMs - 5000) return false;
  if (nowMs - mtimeMs < stableMs) return false;
  if (lastSig === sig) return false;
  return true;
}

export function startPrefetch({ root, runKey, sig, log = () => {}, timeoutMs = 420_000 }) {
  if (state.child) return false;
  let child;
  try { child = spawn(process.execPath, [path.join(root, 'scripts', 'capture-asset.mjs'), '--issue', runKey], { cwd: root, stdio: 'ignore', windowsHide: true }); } catch (e) { log(`${runKey} ambil aset dini gagal dimulai: ${String(e?.message ?? e).slice(0, 100)}`); return false; }
  state.child = child; state.runKey = runKey;
  const t0 = Date.now();
  const timer = setTimeout(() => { try { child.kill(); } catch { /* sudah selesai */ } }, timeoutMs);
  let ended = false;
  const finish = (why) => {
    if (ended) return; ended = true; clearTimeout(timer);
    if (state.child === child) { state.child = null; state.runKey = null; }
    state.done.set(runKey, sig); saveDone(state.done);
    log(`${runKey} ambil aset dini selesai (${why}, ${Math.round((Date.now() - t0) / 1000)} dtk)`);
  };
  child.on('exit', (code) => finish(`kode ${code}`));
  child.on('error', (e) => finish(`galat ${String(e?.message ?? e).slice(0, 60)}`));
  log(`${runKey} ambil aset dini dimulai (Designer masih menyusun desain)`);
  return true;
}
