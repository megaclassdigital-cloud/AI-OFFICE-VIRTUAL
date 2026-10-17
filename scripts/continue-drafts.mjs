#!/usr/bin/env node
// continue-drafts.mjs — melanjutkan produksi yang TERLANJUR terdraft/terblokir, satu per satu, tanpa mengganggu job yang sedang berjalan.
// Aturan (keputusan owner 17 Okt 2026): selesaikan semuanya; bila nanti butuh approval owner tidak masalah. Karena itu bila job berhenti di QA setelah
// jatah revisi habis, hasil diserahkan ke antrean approval owner (--accept-owner) — owner tetap yang menyetujui sebelum apa pun diposting.
// Yang terblokir di tahap selain QA (mis. gerbang aset) TIDAK dipaksa: dilaporkan alasannya. Tiap baris keluaran = satu kejadian (untuk Monitor).
// Pemakaian: node scripts/continue-drafts.mjs EDU-117 EDU-124
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE = path.join(ROOT, 'workspace', 'orchestrator-state.json');
const ids = process.argv.slice(2).filter((x) => /^EDU-[0-9]+$/.test(x));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (m) => console.log(m);
const state = () => { try { return JSON.parse(readFileSync(STATE, 'utf8').replace(/^﻿/, '')); } catch { return null; } };
const idle = (s) => s && !s.job && (s.followers ?? []).length === 0 && (s.pending ?? []).length === 0;
const orch = (...args) => { const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'orchestrator.mjs'), ...args], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 }); return `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split(/\r?\n/).pop() ?? ''; };
const latest = (s, id) => (s?.history ?? []).filter((j) => j.identifier === id).sort((a, b) => (b.endedMs ?? 0) - (a.endedMs ?? 0))[0] ?? null;
const STAGE_NAMES = ['researcher', 'verifier', 'copywriter', 'designer', 'qa'];

async function waitIdle(maxMs) { const t0 = Date.now(); while (Date.now() - t0 < maxMs) { if (idle(state())) return true; await sleep(30_000); } return false; }

async function waitFinish(id, maxMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    await sleep(20_000);
    const s = state(); if (!s) continue;
    if (s.job?.identifier === id) continue;                  // masih berjalan
    const h = latest(s, id);
    if (h && (h.phase === 'done' || h.phase === 'blocked')) return h;
  }
  return null;
}

for (const id of ids) {
  const s0 = state(); const h0 = latest(s0, id);
  const following = s0?.job?.identifier === id; // sudah berjalan (mis. dilanjutkan sebelumnya): cukup diikuti sampai selesai
  if (!following && (!h0 || h0.phase !== 'blocked')) { say(`LEWAT ${id}: tidak terblokir (${h0 ? h0.phase : 'tidak ada di riwayat'})`); continue; }
  if (following) say(`IKUTI ${id}: sedang berjalan; menunggu selesai`);
  else {
    if (!(await waitIdle(6 * 3_600_000))) { say(`BERHENTI ${id}: pipeline tidak kosong dalam 6 jam`); break; }
    await sleep(20_000);
    const stageName = STAGE_NAMES[h0.stageIndex] ?? '?';
    say(`MULAI ${id}: terblokir di ${stageName} (${String(h0.blockReason ?? '').slice(0, 90)}); menilai ulang keluaran`);
    if (stageName === 'designer') { // gerbang aset: lengkapi aset yang masih hilang lebih dulu (yang sudah ter-capture dipertahankan), lalu nilai ulang
      const c = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'capture-asset.mjs'), '--issue', id], { cwd: ROOT, encoding: 'utf8', timeout: 460_000 });
      say(`  aset: ${String(c.stdout ?? '').trim().split(/\r?\n/).filter((l) => /^(captured|missing|owner-supplied|BELUM|kept)/i.test(l)).map((l) => l.slice(0, 70)).join(' | ') || 'tanpa keluaran'}`);
    }
    say(`  ${orch('--recheck', id)}`);
  }
  let h = await waitFinish(id, 90 * 60_000);
  if (!h) { say(`MACET ${id}: tidak selesai dalam 90 menit; periksa manual`); continue; }
  // berhenti di QA karena jatah revisi habis / needs_human: serahkan ke antrean approval owner (owner tetap memutuskan)
  if (h.phase === 'blocked' && STAGE_NAMES[h.stageIndex] === 'qa') {
    say(`  ${id} berhenti di QA (${String(h.blockReason ?? '').slice(0, 100)}); diserahkan ke antrean approval owner`);
    say(`  ${orch('--accept-owner', id, '--note', 'Owner: selesaikan konten terdraft; QA menolak setelah jatah revisi habis, owner yang memutuskan di antrean approval')}`);
    h = await waitFinish(id, 60 * 60_000);
  }
  say(h?.phase === 'done' ? `SELESAI ${id}: menunggu keputusan owner di antrean approval` : `TERBLOKIR ${id} di ${STAGE_NAMES[h?.stageIndex] ?? '?'}: ${String(h?.blockReason ?? 'tanpa alasan').slice(0, 160)}`);
}
say('SELESAI semua yang diminta');
