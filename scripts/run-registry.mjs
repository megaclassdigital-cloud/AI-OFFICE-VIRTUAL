// run-registry.mjs — satu-satunya tempat aturan "kode konten + revisi -> folder run" (keputusan owner 2026-10-09).
// Kode konten TIDAK PERNAH berubah: konten EDU-49 punya folder runs/EDU-49 (versi asli) dan runs/EDU-49/revision-1, revision-2, ... (revisi).
// Nomor issue Paperclip untuk revisi (mis. EDU-53) hanya internal; ia dipetakan ke folder lewat run.json di folder revisi.
// "runKey" = kunci folder: "EDU-49" (asli) atau "EDU-49/revision-1". Selalu bergaris miring maju (aman di Windows dan di prompt agent).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const CONTENT_RE = /^EDU-[0-9]+$/;
export const RUN_KEY_RE = /^EDU-[0-9]+(?:\/revision-[0-9]+)?$/;
const REV_DIR_RE = /^revision-([0-9]+)$/;

export const contentOf = (runKey) => String(runKey).split('/')[0];
export const revisionOf = (runKey) => { const m = /\/revision-([0-9]+)$/.exec(String(runKey)); return m ? Number(m[1]) : 0; };
export const runKeyFor = (contentId, revision = 0) => (revision > 0 ? `${contentId}/revision-${revision}` : contentId);
export const runDirOf = (outputs, runKey) => path.join(outputs, 'runs', ...String(runKey).split('/'));
/** Label untuk owner: "EDU-49" atau "EDU-49 · revisi 1". */
export const labelOf = (runKey) => (revisionOf(runKey) > 0 ? `${contentOf(runKey)} · revisi ${revisionOf(runKey)}` : contentOf(runKey));

/** Nomor revisi yang sudah ada untuk satu konten, terurut naik. */
export function listRevisions(outputs, contentId) {
  const base = runDirOf(outputs, contentId);
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory() && REV_DIR_RE.test(e.name)).map((e) => Number(REV_DIR_RE.exec(e.name)[1])).sort((a, b) => a - b);
}
export const latestRunKey = (outputs, contentId) => runKeyFor(contentId, Math.max(0, ...listRevisions(outputs, contentId)));
export const nextRunKey = (outputs, contentId) => runKeyFor(contentId, Math.max(0, ...listRevisions(outputs, contentId)) + 1);

export function writeRunMeta(outputs, runKey, meta) {
  const dir = runDirOf(outputs, runKey);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ runKey, contentId: contentOf(runKey), revision: revisionOf(runKey), ...meta }, null, 2) + String.fromCharCode(10), 'utf8');
}
export function readRunMeta(outputs, runKey) {
  try { return JSON.parse(readFileSync(path.join(runDirOf(outputs, runKey), 'run.json'), 'utf8').replace(/^﻿/, '')); } catch { return null; }
}

/** Identifier issue master Paperclip untuk sebuah run (asli: sama dengan kode konten; revisi: dari run.json). */
export const masterIdentifierOf = (outputs, runKey) => readRunMeta(outputs, runKey)?.masterIdentifier ?? contentOf(runKey);

/** Cari runKey dari identifier issue master (mis. EDU-53 -> EDU-49/revision-1). Run asli: folder bernama sama. */
export function runKeyForMaster(outputs, masterIdentifier) {
  const direct = runDirOf(outputs, masterIdentifier);
  if (CONTENT_RE.test(masterIdentifier) && existsSync(direct)) {
    const meta = readRunMeta(outputs, masterIdentifier);
    if (!meta || meta.masterIdentifier === masterIdentifier) return masterIdentifier;
  }
  const runs = path.join(outputs, 'runs');
  if (!existsSync(runs)) return null;
  for (const e of readdirSync(runs, { withFileTypes: true })) {
    if (!e.isDirectory() || !CONTENT_RE.test(e.name)) continue;
    for (const n of listRevisions(outputs, e.name)) {
      const key = runKeyFor(e.name, n);
      if (readRunMeta(outputs, key)?.masterIdentifier === masterIdentifier) return key;
    }
  }
  return null;
}

/**
 * Peta nomor master Paperclip (INTERNAL) -> label konten untuk owner, hanya untuk run yang nomornya BERBEDA dari kode konten.
 * Contoh: revisi EDU-97 punya issue master EDU-105; owner tidak perlu tahu nomor itu, ia melihat "EDU-97 · revisi 1".
 */
export function masterLabelMap(outputs) {
  const map = new Map();
  const base = path.join(outputs, 'runs');
  if (!existsSync(base)) return map;
  for (const e of readdirSync(base, { withFileTypes: true })) {
    if (!e.isDirectory() || !CONTENT_RE.test(e.name)) continue;
    for (const n of [0, ...listRevisions(outputs, e.name)]) {
      const key = runKeyFor(e.name, n);
      const master = masterIdentifierOf(outputs, key);
      if (master && master !== e.name) map.set(master, labelOf(key));
    }
  }
  return map;
}

/** Ganti nomor master internal pada teks bebas (log, pesan) dengan label konten. Nomor lain dibiarkan apa adanya. */
export function humanizeIds(text, map) {
  const s = String(text);
  if (!map || !map.size) return s;
  return s.replace(/\bEDU-[0-9]+\b/g, (id) => map.get(id) ?? id);
}

/** Judul revisi tanpa awalan "Revisi" berulang ("Revisi Revisi X" -> "Revisi X"). */
export const revisiTitle = (t) => `Revisi ${String(t ?? '').replace(/^(Revisi\s+)+/i, '').trim()}`.trim();
