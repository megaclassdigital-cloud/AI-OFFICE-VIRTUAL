// browser-lock.mjs — satu pemakai Chrome sosial (profil + port debug yang sama) pada satu waktu: Admin Publikasi (posting) ATAU pembaca analitik.
// Tanpa kunci ini dua proses bisa saling menutup Chrome di tengah posting. Kunci berumur pendek (basi otomatis) supaya sisa crash tidak menahan selamanya.
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fileFor = (name = 'browser') => path.join(ROOT, 'workspace', 'agent', 'autonomy', `${name}.lock.json`); // 'browser' = Chrome sosial (worker/insights); 'search' = Chrome pencarian gambar
export const MAX_AGE_MS = 10 * 60_000;

const read = (name) => { try { return JSON.parse(readFileSync(fileFor(name), 'utf8').replace(/^﻿/, '')); } catch { return null; } };

/** Pemegang kunci yang masih segar ('worker' | 'insights') atau null. */
export function browserHolder(nowMs = Date.now(), name) {
  const l = read(name);
  return l && Number.isFinite(l.at) && nowMs - l.at < MAX_AGE_MS ? l.owner : null;
}

/** Ambil kunci bila bebas (atau sudah milik sendiri). Mengembalikan true bila berhasil. */
export function acquireBrowser(owner, nowMs = Date.now(), name) {
  const h = browserHolder(nowMs, name);
  if (h && h !== owner) return false;
  mkdirSync(path.dirname(fileFor(name)), { recursive: true });
  writeFileSync(fileFor(name), JSON.stringify({ owner, at: nowMs, pid: process.pid }), 'utf8');
  return true;
}

export function releaseBrowser(owner, name) {
  try { if (existsSync(fileFor(name)) && read(name)?.owner === owner) unlinkSync(fileFor(name)); } catch { /* sudah hilang */ }
}
