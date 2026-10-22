// autonomy.mjs — sisi I/O kantor otonom (ADR-0005 P3): dipanggil orkestrator tiap putaran. Keputusannya ada di autonomy-core.mjs (murni, dites).
// Berkas (workspace/agent/autonomy/): settings.json (milik owner), status.json (untuk UI), log.json (brief otomatis yang dibuat), insights.json (analitik akun).
// Tidak memanggil LLM sendiri: hanya menulis brief ke inbox, lalu orkestrator + Manager memprosesnya seperti brief owner.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readJsonSafe, writeJsonAtomic } from './safe-json.mjs';
import { inWarmup } from './away-core.mjs';
import { decideAutoBrief, buildAutoBrief, isAutoBrief, mergeSettings, autoOutcomes, DEFAULTS, AUTO_MARKER } from './autonomy-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DIR = path.join(ROOT, 'workspace', 'agent', 'autonomy');
const F = { settings: path.join(DIR, 'settings.json'), status: path.join(DIR, 'status.json'), log: path.join(DIR, 'log.json'), insights: path.join(DIR, 'insights.json'), breaker: path.join(DIR, 'breaker.json') };
const INBOX = path.join(ROOT, 'workspace', 'inbox');
const HOLDS = path.join(ROOT, 'workspace', 'agent', 'holds');
const BOARD = path.join(ROOT, 'workspace', 'board-cache.json');
const MIN = 60_000; const HOUR = 60 * MIN;
const INSIGHTS_WAIT_MS = 4 * MIN;

/** Konten yang menunggu keputusan owner (status board 'menunggu_approval', dibuat <= 5 hari lalu supaya sisa uji lama tidak menghitung). */
export function awaitingOwnerCount(nowMs) {
  const items = readJsonSafe(BOARD, null)?.items ?? [];
  return items.filter((i) => i.status?.key === 'menunggu_approval' && nowMs - (Date.parse(i.createdAt ?? '') || 0) < 5 * 24 * HOUR).length;
}

function recentTitles(insights) {
  const items = readJsonSafe(BOARD, null)?.items ?? [];
  const fromBoard = items.map((i) => String(i.caption ?? '').trim()).filter((t) => t && !/^Revisi /.test(t));
  const all = [...(insights?.analysis?.recentTitles ?? []), ...fromBoard].map((t) => t.replace(/\s+/g, ' ').slice(0, 90));
  return [...new Set(all)];
}

function spawnInsights(log) {
  try {
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'audience-insights.mjs')], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true });
    child.unref(); log('analitik akun dibaca ulang (proses terpisah)');
    return true;
  } catch (e) { log('gagal memulai analitik: ' + String(e.message).slice(0, 100)); return false; }
}

/**
 * Satu putaran. state = state orkestrator (job, followers, pending, history). Mengembalikan { acted, code, reason }.
 * Tidak melempar galat ke orkestrator: tanggung jawab pemanggil membungkus try/catch sebagai pengaman tambahan.
 */
const BOOT_MS = Date.now(); // saat proses ini dinyalakan (boot, mati listrik, restart)
export function autonomyTick({ state, nowMs = Date.now(), paused = false, offline = false, log = () => {} }) {
  mkdirSync(DIR, { recursive: true });
  // Masa pemanasan: sesudah dinyalakan, beri sistem waktu stabil sebelum menyusun brief baru yang memakai token (mencegah brief otomatis saat boot tak terduga/RAM sesak).
  if (!paused && inWarmup(BOOT_MS, nowMs)) {
    try { writeJsonAtomic(F.status, { ...(readJsonSafe(F.status, {}) ?? {}), at: nowMs, code: 'pemanasan', reason: 'Sistem baru dinyalakan: menunggu stabil sebelum menyusun brief', acted: false }); } catch { /* informasi saja */ }
    return { acted: false, code: 'pemanasan', reason: 'menunggu sistem stabil setelah dinyalakan' };
  }
  if (!existsSync(F.settings)) writeJsonAtomic(F.settings, { ...DEFAULTS });
  const settings = mergeSettings(readJsonSafe(F.settings, {}) ?? {});
  const prev = readJsonSafe(F.status, {}) ?? {};
  const briefLog = readJsonSafe(F.log, []) ?? [];
  const insights = readJsonSafe(F.insights, null);

  // 1. rencana brief otomatis tidak perlu menunggu owner di mode tinjau rencana (approval akhir konten tetap owner)
  let released = 0;
  if (settings.enabled && settings.autoReleasePlan) {
    for (const p of state.pending ?? []) {
      if (p.hold && isAutoBrief(p.brief)) {
        const rel = path.join(HOLDS, `${p.identifier}.release`);
        if (!existsSync(rel)) { mkdirSync(HOLDS, { recursive: true }); writeFileSync(rel, `{"by":"autonomy","at":${nowMs}}`, 'utf8'); released += 1; log(`${p.identifier}: rencana brief otomatis dilepas Manager (tanpa menunggu owner)`); }
      }
    }
  }

  // 2. pemutus: job otomatis terblokir berturut-turut => berhenti sementara
  const breaker = readJsonSafe(F.breaker, {}) ?? {};
  const inbox = existsSync(INBOX) ? readdirSync(INBOX).filter((n) => /\.(md|txt|json)$/i.test(n)).length : 0;
  const decision = decideAutoBrief({
    settings, nowMs, paused, offline, lowMemory: os.freemem() < 700 * 1024 * 1024,
    idle: { job: !!state.job, followers: (state.followers ?? []).length, pending: (state.pending ?? []).length, inbox },
    awaitingOwner: awaitingOwnerCount(nowMs), briefLog,
    recentAutoOutcomes: autoOutcomes(state.history, breaker.resetAfterMs ?? 0), // hasil sebelum pemutus terakhir tidak dihitung lagi
    breakerUntilMs: breaker.untilMs ?? null,
  });
  if (decision.trip) { writeJsonAtomic(F.breaker, { untilMs: decision.retryAtMs, resetAfterMs: nowMs, reason: decision.reason }); log('PEMUTUS kantor otonom: ' + decision.reason); }

  const baseStatus = { at: nowMs, enabled: settings.enabled, code: decision.code, reason: decision.reason, retryAtMs: decision.retryAtMs ?? null, awaitingOwner: awaitingOwnerCount(nowMs), briefsToday: briefLog.filter((e) => nowMs - e.atMs < 24 * HOUR).length, lastBriefAt: briefLog.length ? Math.max(...briefLog.map((e) => e.atMs)) : null, insightsAt: insights?.at ?? null, insightsNotes: insights?.analysis?.notes ?? [], released, settings: { maxPerDay: settings.maxPerDay, minGapMinutes: settings.minGapMinutes, maxAwaitingOwner: settings.maxAwaitingOwner, quietHours: settings.quietHours } };
  if (!decision.act) { writeJsonAtomic(F.status, { ...baseStatus, acted: false }); return { acted: false, code: decision.code, reason: decision.reason }; }

  // 3. analitik basi: baca ulang dulu (maks 4 menit menunggu), supaya brief memakai profil audiens yang segar
  const stale = !insights || nowMs - insights.at > settings.insightsRefreshHours * HOUR;
  if (stale) {
    const since = prev.insightsWaitSince && nowMs - prev.insightsWaitSince < INSIGHTS_WAIT_MS ? prev.insightsWaitSince : null;
    if (!since && !(prev.insightsTriedMs && nowMs - prev.insightsTriedMs < 30 * MIN)) {
      spawnInsights(log);
      writeJsonAtomic(F.status, { ...baseStatus, acted: false, code: 'menunggu-analitik', reason: 'Membaca performa akun sebelum menyusun brief', insightsWaitSince: nowMs, insightsTriedMs: nowMs });
      return { acted: false, code: 'menunggu-analitik', reason: 'membaca analitik akun' };
    }
    if (since) { writeJsonAtomic(F.status, { ...baseStatus, acted: false, code: 'menunggu-analitik', reason: 'Membaca performa akun sebelum menyusun brief', insightsWaitSince: since, insightsTriedMs: prev.insightsTriedMs }); return { acted: false, code: 'menunggu-analitik', reason: 'menunggu analitik' }; }
    // sudah dicoba <30 menit lalu atau batas tunggu habis: lanjut dengan data yang ada (bila ada)
  }

  // 4. susun dan tulis brief ke inbox
  const brief = buildAutoBrief({ nowMs, utcOffsetMinutes: settings.utcOffsetMinutes, insights: insights?.analysis ?? null, insightsAtMs: insights?.at ?? null, recentTitles: recentTitles(insights), freshHours: settings.freshHours });
  const file = `auto-${nowMs}-brief.md`;
  mkdirSync(INBOX, { recursive: true });
  writeFileSync(path.join(INBOX, file), brief, 'utf8');
  const entry = { atMs: nowMs, file, withInsights: !!insights?.analysis?.n };
  writeJsonAtomic(F.log, [...briefLog, entry].slice(-100));
  writeJsonAtomic(F.status, { ...baseStatus, acted: true, code: 'brief-dibuat', reason: `Brief otomatis dibuat (${file})`, lastBriefAt: nowMs, briefsToday: baseStatus.briefsToday + 1 });
  log(`Manager mengambil inisiatif: brief otomatis ${file} (${entry.withInsights ? 'dengan' : 'tanpa'} profil audiens)`);
  return { acted: true, code: 'brief-dibuat', reason: file };
}

export { AUTO_MARKER };
export const autonomyStatus = () => readJsonSafe(F.status, null);
