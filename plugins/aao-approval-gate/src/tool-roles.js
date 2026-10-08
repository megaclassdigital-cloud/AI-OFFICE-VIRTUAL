// Pembatasan tool per peran agent (FIX-G1-05). Generik: plugin tidak tahu nama agent EdukasiAI;
// pemetaan tool -> nama agent yang boleh memakainya datang dari berkas milik division
// (divisions/<key>/tool-roles.json), digabung (union) bila ada beberapa division.
//
// Gagal TERTUTUP: tool yang dibatasi (GATED_TOOLS) ditolak bila pemetaannya tidak ada, tidak terbaca, atau nama agent
// pemanggil tidak dapat dipastikan. Tool lain (post_comment, attach_file, ...) tidak dibatasi di sini.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

/** Tool yang hanya masuk akal untuk peran tertentu; tanpa pemetaan = ditolak. */
export const GATED_TOOLS = Object.freeze(['verify_candidate', 'render_carousel', 'qa_submit_result', 'handoff_to_owner']);

/** Gabungkan semua divisions/<key>/tool-roles.json di bawah repoRoot. @returns {{map:Record<string,string[]>, files:string[], errors:string[]}} */
export function loadToolRoles(repoRoot, { extraFile } = {}) {
  const map = {}; const files = []; const errors = [];
  const candidates = [];
  const divRoot = path.join(repoRoot, 'divisions');
  if (existsSync(divRoot)) {
    for (const d of readdirSync(divRoot, { withFileTypes: true })) {
      if (d.isDirectory()) candidates.push(path.join(divRoot, d.name, 'tool-roles.json'));
    }
  }
  if (extraFile) candidates.push(extraFile);
  for (const f of candidates) {
    if (!existsSync(f)) continue;
    try {
      const raw = JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, ''));
      for (const [tool, names] of Object.entries(raw)) {
        if (!Array.isArray(names) || names.some((n) => typeof n !== 'string' || !n.trim())) throw new Error(`"${tool}" harus array nama agent`);
        map[tool] = [...new Set([...(map[tool] ?? []), ...names])];
      }
      files.push(f);
    } catch (e) { errors.push(`${f}: ${e.message}`); }
  }
  return { map, files, errors };
}

/** @returns {string|null} pesan penolakan, atau null bila boleh */
export function checkToolRole(toolName, agentName, map) {
  const allowed = map?.[toolName];
  if (!allowed) return GATED_TOOLS.includes(toolName) ? `tool ${toolName} dibatasi per peran dan pemetaan peran belum dikonfigurasi (tolak demi keamanan)` : null;
  if (!agentName) return `peran agent pemanggil tidak dapat dipastikan; ${toolName} ditolak`;
  return allowed.includes(agentName) ? null : `agent "${agentName}" tidak diizinkan memakai ${toolName} (hanya: ${allowed.join(', ')})`;
}

/**
 * Bungkus handler tool: periksa peran sebelum menjalankan. `getRoles` dipanggil tiap panggilan supaya perubahan berkas
 * terbaca tanpa restart. `resolveName(run)` mengembalikan nama agent atau null.
 */
export function gateTool(toolName, handler, { getRoles, resolveName }) {
  return async (params, run) => {
    let name = null;
    try { name = await resolveName(run); } catch { name = null; }
    const { map, errors } = getRoles();
    const msg = checkToolRole(toolName, name, map) ?? (errors.length && GATED_TOOLS.includes(toolName) && !map[toolName] ? `pemetaan peran rusak: ${errors[0]}` : null);
    if (msg) return { error: msg, data: { ok: false, error: msg } };
    return handler(params, run);
  };
}
