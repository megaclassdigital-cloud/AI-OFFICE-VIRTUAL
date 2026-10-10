// heartbeat.mjs — detak jantung komponen (orkestrator, failover): bukti hidup + bukti terhubung ke Paperclip yang bisa dibaca pengawas.
// Penulis: komponen itu sendiri tiap putaran; pembaca: office-launcher (dan Office View). Tanpa LLM.
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const heartbeatDir = (root) => path.join(root, 'workspace', 'heartbeats');

export function writeHeartbeat(root, name, data = {}, nowMs = Date.now()) {
  try {
    mkdirSync(heartbeatDir(root), { recursive: true });
    writeFileSync(path.join(heartbeatDir(root), `${name}.json`), JSON.stringify({ name, pid: process.pid, at: nowMs, ...data }) + String.fromCharCode(10), 'utf8');
  } catch { /* detak jantung tidak boleh pernah menjatuhkan komponen */ }
}

export function readHeartbeat(root, name) {
  try { return JSON.parse(readFileSync(path.join(heartbeatDir(root), `${name}.json`), 'utf8').replace(/^﻿/, '')); } catch { return null; }
}

export const isFresh = (hb, maxAgeMs, nowMs = Date.now()) => Boolean(hb && Number.isFinite(hb.at) && nowMs - hb.at <= maxAgeMs);

/** Galat yang berarti Paperclip tidak terjangkau (bukan galat tugas): dipakai komponen untuk menandai paperclipOk=false. */
export const isConnectionError = (text) => /fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|socket hang up|connect ETIMEDOUT|network/i.test(String(text ?? ''));

/** Kunci proses tunggal: mencegah dua pengawas/orkestrator berjalan bersamaan (dua orkestrator = pekerjaan ganda). */
export function acquireLock(root, name, alive = (p) => { try { process.kill(p, 0); return true; } catch { return false; } }) {
  const file = path.join(root, 'workspace', `${name}.lock`);
  try {
    if (existsSync(file)) {
      const pid = Number(readFileSync(file, 'utf8').trim());
      if (Number.isInteger(pid) && pid > 0 && pid !== process.pid && alive(pid)) return { ok: false, pid, file };
    }
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, String(process.pid), 'utf8');
    return { ok: true, pid: process.pid, file };
  } catch { return { ok: true, pid: process.pid, file }; }
}
export function releaseLock(file) { try { if (readFileSync(file, 'utf8').trim() === String(process.pid)) unlinkSync(file); } catch { /* sudah hilang */ } }
