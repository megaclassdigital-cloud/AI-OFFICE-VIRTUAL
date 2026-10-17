// browser-lock.mjs — satu pemakai Chrome sosial (profil + port debug yang sama) pada satu waktu: Admin Publikasi (posting) ATAU pembaca analitik.
// Tanpa kunci ini dua proses bisa saling menutup Chrome di tengah posting. Kunci berumur pendek (basi otomatis) supaya sisa crash tidak menahan selamanya.
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILE = path.join(ROOT, 'workspace', 'agent', 'autonomy', 'browser.lock.json');
export const MAX_AGE_MS = 10 * 60_000;

const read = () => { try { return JSON.parse(readFileSync(FILE, 'utf8').replace(/^﻿/, '')); } catch { return null; } };

/** Pemegang kunci yang masih segar ('worker' | 'insights') atau null. */
export function browserHolder(nowMs = Date.now()) {
  const l = read();
  return l && Number.isFinite(l.at) && nowMs - l.at < MAX_AGE_MS ? l.owner : null;
}

/** Ambil kunci bila bebas (atau sudah milik sendiri). Mengembalikan true bila berhasil. */
export function acquireBrowser(owner, nowMs = Date.now()) {
  const h = browserHolder(nowMs);
  if (h && h !== owner) return false;
  mkdirSync(path.dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify({ owner, at: nowMs, pid: process.pid }), 'utf8');
  return true;
}

export function releaseBrowser(owner) {
  try { if (existsSync(FILE) && read()?.owner === owner) unlinkSync(FILE); } catch { /* sudah hilang */ }
}
