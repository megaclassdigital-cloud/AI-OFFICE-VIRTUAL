// queue.mjs — antrean autoposter dari catatan APPROVAL owner (output/approvals/<issue>/*.json). KODE, tanpa LLM.
// Aturan: hanya keputusan TERAKHIR per issue yang berlaku; hanya yang `approved` dan diputuskan SETELAH autopostSince; isi yang akan diunggah harus
// memiliki hash yang SAMA dengan yang disetujui (rumus plugin: packageContentHash); konten dipostingkan sekali per platform (ledger).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { packageContentHash } from '../../plugins/aao-approval-gate/src/content-hash.js';
import { CONTENT_RE, contentOf, runDirOf, runKeyForMaster } from '../run-registry.mjs';
import { canPostLive, cooldownStatus, formatRemaining, mergeAutopostSettings } from './guards.mjs';

const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch { return null; } };

/** Keputusan TERAKHIR per issue (berdasarkan decided_at) dari folder approvals. */
export function latestDecisions(approvalsDir) {
  const out = new Map();
  if (!existsSync(approvalsDir)) return out;
  for (const e of readdirSync(approvalsDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    for (const f of readdirSync(path.join(approvalsDir, e.name)).filter((x) => x.endsWith('.json'))) {
      const rec = readJson(path.join(approvalsDir, e.name, f));
      if (!rec?.decided_at || !['approved', 'rejected'].includes(rec.decision)) continue;
      const prev = out.get(e.name);
      if (!prev || Date.parse(rec.decided_at) >= Date.parse(prev.decided_at)) out.set(e.name, rec);
    }
  }
  return out;
}

/** Hash gabungan paket di folder run saat ini (carousel.json + carousel-design.json + render/hashes.json), atau null bila ada yang hilang. */
export function currentContentHash(outputs, runKey) {
  const dir = runDirOf(outputs, runKey);
  const carousel = readJson(path.join(dir, 'carousel.json')); const design = readJson(path.join(dir, 'carousel-design.json')); const hashes = readJson(path.join(dir, 'render', 'hashes.json'));
  return carousel && design && hashes ? packageContentHash({ carousel, design }, hashes).combined : null;
}

/**
 * Kandidat posting: approval TERAKHIR berstatus approved, diputuskan >= sinceMs. Mengembalikan daftar (terlama dulu) dan daftar yang DIABAIKAN
 * (approved sebelum autopostSince atau tanpa run yang dikenal) supaya owner tahu mengapa tidak diposting.
 */
export function approvedCandidates({ outputs, approvalsDir, sinceMs }) {
  const candidates = []; const ignored = [];
  for (const [issueId, rec] of latestDecisions(approvalsDir)) {
    if (rec.decision !== 'approved') continue;
    const approvedAt = Date.parse(rec.decided_at);
    const ident = rec.issue_identifier;
    const runKey = CONTENT_RE.test(ident) || /^EDU-[0-9]+$/.test(ident) ? runKeyForMaster(outputs, ident) : null;
    if (!runKey) { ignored.push({ issueId, identifier: ident, reason: 'run konten tidak ditemukan' }); continue; }
    if (sinceMs == null || approvedAt < sinceMs) { ignored.push({ issueId, identifier: ident, content: contentOf(runKey), reason: sinceMs == null ? 'autopostSince belum diatur' : 'approved sebelum autopostSince (konten lama)' }); continue; }
    const now = currentContentHash(outputs, runKey);
    candidates.push({ issueId, identifier: ident, content: contentOf(runKey), runKey, approvedAt, approvedHash: rec.content_hash?.combined ?? null, currentHash: now, hashMatches: !!now && now === rec.content_hash?.combined });
  }
  candidates.sort((a, b) => a.approvedAt - b.approvedAt);
  return { candidates, ignored };
}

/**
 * Pilih SATU posting berikutnya: untuk tiap platform dengan live=true, konten approved tertua yang lolos semua pagar (canPostLive).
 * Mengembalikan { pick: {platform, candidate} | null, blocked: [{platform, content, reasons}] }.
 */
export function nextToPost({ candidates, ledger, settings, nowMs, platforms }) {
  const s = mergeAutopostSettings(settings); const blocked = [];
  for (const platform of platforms ?? Object.keys(s.platforms)) {
    if (s.platforms[platform]?.live !== true) continue;
    for (const c of candidates) {
      const r = canPostLive({ settings: s, platform, ledger, content: c.content, approval: { approved: true, hashMatches: c.hashMatches }, nowMs });
      if (r.ok) return { pick: { platform, candidate: c }, blocked };
      blocked.push({ platform, content: c.content, reasons: r.reasons });
    }
  }
  return { pick: null, blocked };
}

/** Status untuk papan TV: jeda tiap platform dan hitung mundur, kandidat, yang diabaikan. */
export function buildStatus({ settings, ledger, candidates, ignored, blocked, nowMs }) {
  const s = mergeAutopostSettings(settings);
  const platforms = {};
  for (const [name, p] of Object.entries(s.platforms)) {
    const c = cooldownStatus(ledger, name, s, nowMs);
    const posted = (ledger ?? []).filter((e) => e.mode === 'live' && e.platform === name && e.status === 'diposting').length;
    platforms[name] = { live: p.live === true, ...c, remainingText: formatRemaining(c.remainingMs), postedTotal: posted };
  }
  const waiting = (candidates ?? []).filter((c) => !(ledger ?? []).some((e) => e.mode === 'live' && e.content === c.content && ['diposting', 'sedang_diposting', 'tidak_pasti'].includes(e.status))).length;
  return { paused: s.paused, since: s.autopostSince, cooldownHours: s.cooldownHours, platforms, approvedWaiting: waiting, ignoredOld: (ignored ?? []).length, blocked: (blocked ?? []).slice(0, 6), at: new Date(nowMs).toISOString() };
}
